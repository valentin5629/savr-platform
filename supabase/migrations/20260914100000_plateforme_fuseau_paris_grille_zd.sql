-- Migration : fuseau métier unique — rpc_creer_grille_zd
-- ------------------------------------------------------------------------------
-- `current_date` est résolu dans le fuseau de SESSION (UTC sur Supabase) : une
-- grille ZD créée entre 22h et minuit à Paris prenait effet la VEILLE, donc
-- s'appliquait rétroactivement à des collectes déjà tarifées (§04 « tarifs ZD
-- versionnés, jamais modifiés rétroactivement »).
--
-- Ancrage explicite en Europe/Paris, comme la migration 20260620100000
-- (fix_tz_seuil_12h_ag) l'a fait pour le seuil 12h AG. Corps copié VERBATIM de
-- la migration source 20260704170000 ; SEULE la ligne de `v_valide` change.
-- Signature, droits et appelants inchangés.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plateforme.rpc_creer_grille_zd(
  p_nom         text,
  p_mode        plateforme.mode_grille_zd,
  p_est_defaut  boolean,
  p_valide_du   date,
  p_paliers     jsonb,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $fn$
DECLARE
  v_grille_id uuid;
  v_row       jsonb;
  v_p         jsonb;
  v_valide    date := COALESCE(p_valide_du, (now() AT TIME ZONE 'Europe/Paris')::date);
BEGIN
  IF p_nom IS NULL OR length(trim(p_nom)) = 0 THEN
    RAISE EXCEPTION 'nom obligatoire' USING errcode = '22023';
  END IF;
  IF p_paliers IS NULL OR jsonb_array_length(p_paliers) = 0 THEN
    RAISE EXCEPTION 'au moins un palier obligatoire' USING errcode = '22023';
  END IF;

  -- Versionnement close-then-create : une nouvelle grille par défaut ferme
  -- l''ancienne défaut active (jamais rétroactif — l''index unique
  -- uniq_grille_tarifaire_defaut garantit l''unicité de la défaut active).
  IF COALESCE(p_est_defaut, false) THEN
    UPDATE plateforme.grilles_tarifaires_zd
      SET est_defaut    = false,
          actif         = false,
          valide_jusqu  = COALESCE(valide_jusqu, v_valide - 1),
          updated_at    = now()
      WHERE est_defaut = true AND actif = true;
  END IF;

  INSERT INTO plateforme.grilles_tarifaires_zd
    (nom, description, mode, est_defaut, actif, valide_du)
  VALUES
    (p_nom, p_description, p_mode, COALESCE(p_est_defaut, false), true, v_valide)
  RETURNING id INTO v_grille_id;

  FOR v_p IN SELECT * FROM jsonb_array_elements(p_paliers)
  LOOP
    INSERT INTO plateforme.tarifs_zero_dechet
      (grille_id, pax_min, pax_max, prix_base_ht, prix_par_couvert_ht)
    VALUES (
      v_grille_id,
      (v_p ->> 'pax_min')::int,
      NULLIF(v_p ->> 'pax_max', '')::int,
      COALESCE((v_p ->> 'prix_base_ht')::numeric, 0),
      CASE
        WHEN p_mode = 'paliers' THEN 0
        ELSE COALESCE((v_p ->> 'prix_par_couvert_ht')::numeric, 0)
      END
    );
  END LOOP;

  SELECT to_jsonb(g.*) INTO v_row
  FROM plateforme.grilles_tarifaires_zd g
  WHERE g.id = v_grille_id;

  RETURN v_row;
END;
$fn$;

COMMENT ON FUNCTION plateforme.rpc_creer_grille_zd(text, plateforme.mode_grille_zd, boolean, date, jsonb, text) IS
  'Crée une grille tarifaire ZD versionnée. Date de prise d''effet par défaut = jour courant à Paris (fuseau métier), jamais le jour UTC.';

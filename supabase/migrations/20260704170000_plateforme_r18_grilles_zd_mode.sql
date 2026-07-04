-- ===========================================================================
-- R18 / BL-P2-04 — Grilles tarifaires ZD : colonne `mode` + création versionnée
-- ---------------------------------------------------------------------------
-- Contexte (ÉTAPE 0 R18) : le handler POST /admin/grilles-tarifaires-zd lisait
-- un paramètre `methode` — colonne INEXISTANTE sur plateforme.grilles_tarifaires_zd
-- (ni sur le schéma live, ni sur le DDL cible) → HTTP 422 systématique à la
-- création (finding column-db, latent car aucune UI n'appelait le POST).
--
-- Le DDL cible V2 (specs/ddl-cible/schema_cible_v2.sql:131,748-758) porte
-- `grilles_tarifaires_zd.mode plateforme.mode_grille_zd NOT NULL`
-- (enum 'paliers'|'fixe_variable'). Donc `methode` = mauvais nom de `mode`.
-- On CONVERGE vers la cible (Frontière garde-fou 1 : V1 ⊂ DDL cible) plutôt que
-- d'inventer une colonne `methode text` divergente.
--
-- CDC §9 (06 - Back-office Admin Savr.md:737-743) :
--   - catalogue : nom + mode (paliers/fixe_variable) + défaut + validité + nb orgas
--   - paliers      → montant fixe HT par tranche (par-pax masqué, forcé 0)
--   - fixe_variable→ montant fixe HT + montant par pax HT par tranche
--   - une seule grille est_defaut active ; modification = fermeture + création
--     d'une nouvelle (jamais rétroactif — Tarifs ZD versionnés, CLAUDE.md §4).
-- ===========================================================================

-- 1. Enum mode_grille_zd — identique au DDL cible (schema_cible_v2.sql:131)
DO $$
BEGIN
  CREATE TYPE plateforme.mode_grille_zd AS ENUM ('paliers', 'fixe_variable');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- 2. Colonne `mode` : add nullable → backfill → SET NOT NULL (backward-compatible).
--    Backfill 'paliers' : la seule grille seedée ("Grille standard V1",
--    m1_3_correct_grille_standard.sql) est une grille de paliers forfaitaires purs
--    (§05 §1 : montant fixe, 0€/pax sauf palier >1000). Le NOT NULL final matche la
--    cible (pas de DEFAULT côté colonne — la valeur est explicite à la création).
ALTER TABLE plateforme.grilles_tarifaires_zd
  ADD COLUMN IF NOT EXISTS mode plateforme.mode_grille_zd;

UPDATE plateforme.grilles_tarifaires_zd
  SET mode = 'paliers'
  WHERE mode IS NULL;

ALTER TABLE plateforme.grilles_tarifaires_zd
  ALTER COLUMN mode SET NOT NULL;

COMMENT ON COLUMN plateforme.grilles_tarifaires_zd.mode IS
  'Mode de tarification (paliers = montant fixe/tranche ; fixe_variable = fixe + par-pax). Converge DDL cible V2.';

-- 3. RPC création grille ZD versionnée (atomique : ferme l''ancienne défaut +
--    insère l''entête + insère les paliers). Réservé service_role (le handler
--    passe par createAdminSupabaseClient), pattern aligné sur rpc_maj_taux_recyclage.
--    En mode 'paliers', prix_par_couvert_ht est forcé à 0 (CDC l.740).
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
  v_valide    date := COALESCE(p_valide_du, current_date);
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

REVOKE ALL ON FUNCTION
  plateforme.rpc_creer_grille_zd(text, plateforme.mode_grille_zd, boolean, date, jsonb, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  plateforme.rpc_creer_grille_zd(text, plateforme.mode_grille_zd, boolean, date, jsonb, text)
  TO service_role;

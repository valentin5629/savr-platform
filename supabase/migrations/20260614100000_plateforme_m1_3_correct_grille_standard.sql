-- M1.3 — Correction grille tarifaire Standard V1
-- Divergence détectée : le seed bloc8 avait des valeurs placeholder (affines avec base + par couvert).
-- La spec §05 §1 définit des paliers forfaitaires purs (montant fixe, 0€/pax sauf >1000).
-- Paliers corrects :  1-250→450€  |  251-500→600€  |  501-750→800€  |  751-1000→1000€  |  >1000→1€/pax
-- Divergence M1.3_20260614 enregistrée dans _Divergences/.

DO $$
DECLARE
  v_grille_id uuid;
BEGIN
  SELECT id INTO v_grille_id
  FROM plateforme.grilles_tarifaires_zd
  WHERE est_defaut = true AND actif = true
  LIMIT 1;

  IF v_grille_id IS NULL THEN
    -- Cas rare : grille pas encore créée (environnement vierge sans bloc8)
    INSERT INTO plateforme.grilles_tarifaires_zd (nom, description, est_defaut, actif, valide_du)
    VALUES ('Grille standard V1', 'Grille tarifaire ZD par défaut — V1', true, true, '2026-01-01')
    RETURNING id INTO v_grille_id;
  END IF;

  -- Supprime les anciens paliers (mauvaises valeurs placeholder du seed bloc8)
  DELETE FROM plateforme.tarifs_zero_dechet WHERE grille_id = v_grille_id;

  -- Réinsère les paliers corrects conformes à la spec §05 §1
  INSERT INTO plateforme.tarifs_zero_dechet
    (grille_id, pax_min, pax_max, prix_base_ht, prix_par_couvert_ht)
  VALUES
    (v_grille_id,    1,   250, 450.00, 0.00),
    (v_grille_id,  251,   500, 600.00, 0.00),
    (v_grille_id,  501,   750, 800.00, 0.00),
    (v_grille_id,  751,  1000, 1000.00, 0.00),
    (v_grille_id, 1001,  NULL, 0.00, 1.00);
END $$;

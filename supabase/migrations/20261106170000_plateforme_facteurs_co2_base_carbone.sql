-- Facteurs CO₂ : une seule source, la Base Carbone ADEME (décision Val
-- 2026-11-06, dossier de sources préparé pour VIPARIS).
--
-- Règle : pour chaque flux, le facteur du traitement réellement appliqué ;
-- « Impacts » = CO₂ émis, « Emissions évitées » = CO₂ évité (kg CO₂e / t).
-- Valeurs relevées dans l'outil Empreinte carbone (onglet Base Carbone ADEME)
-- et recoupées dans le fichier officiel V23.6 (identifiants entre parenthèses) :
--   verre            Emballages · Verre · Recyclage              639 / 1158 (34472/34473)
--   carton           Emballages · Carton · Recyclage             992 /  379 (34480/34481)
--   biodechet        Déchets de cuisine · Méthanisation          173 /   12 (34636/34637)
--   dechet_residuel  OMR · Incinération                          374 /  212 (34650/34651)
--   mix : PET bouteilles recyclage 662/1741 (34492/34493), PE bouteilles
--   recyclage 434/1442 (34522/34523), aluminium recyclage 873/8432
--   (34460/34461), carton-papier = carton, refus = OMR incinération.
--   Approchés (aucun facteur d'emballage dans la base) : acier = Déchets du
--   bâtiment · Métaux ferreux · fin de vie moyenne 938/2211 ; briques = carton.
--   Anti-Gaspi : Repas · moyen 2,04 kg CO₂e/repas (20682).
--   Équivalences : voiture moyenne 2023 0,256 kg/km (43791), repas avec bœuf
--   7,26 (20689). Non utilisés dans le calcul : électricité 2024 0,0519
--   (43642), gaz naturel 2022 0,239 (37132), compostage industriel 0,140 kg/kg
--   (34638).
-- Inchangés : parts du mix, énergie primaire évitée (absente de la Base
-- Carbone, à arbitrer), forfait transport, consommation d'un foyer.
--
-- Une valeur n'est remplacée que si elle est encore celle posée par
-- 20261020220000 (ou, pour les autres paramètres, celle du seed) : une valeur
-- déjà modifiée par un admin est conservée (NOTICE). Le mix n'est remplacé que
-- si ses 7 lignes portent toutes les valeurs attendues.
--
-- Traçabilité : les historiques `*_history` exigent un auteur qu'une migration
-- n'a pas ; leurs déclencheurs sont suspendus le temps des UPDATE et la
-- correction est inscrite dans `audit_log` (avant / après + motif).
-- `parametres_co2_divers` passe par son déclencheur d'audit habituel.
--
-- Les collectes déjà calculées gardent leurs valeurs figées
-- (R_co2_snapshot_fige) : aucune n'est recalculée ici.
--
-- Retour arrière : valeurs d'origine dans `audit_log` (actions
-- `parametres_facteurs_co2_correction`, `parametres_mix_emballages_correction`,
-- `parametres_facteurs_co2_ag_correction`) et dans l'audit de
-- `parametres_co2_divers`.

DO $migration$
DECLARE
  v_motif constant text :=
    'Facteurs CO₂ : source unique Base Carbone ADEME (décision Val 2026-11-06)';
  v_avant     jsonb;
  v_apres     jsonb;
  v_mix_avant jsonb;
  v_mix_apres jsonb;
  v_ag_avant  jsonb;
  v_ag_apres  jsonb;
  v_n         int;
  v_induit    decimal(8,2);
  v_evite     decimal(8,2);
BEGIN
  PERFORM set_config('savr.audit_motif', v_motif, true);

  -- Contrôle d'entrée, en forme positive : sous RLS forcée, un rôle sans
  -- BYPASSRLS ne verrait aucune ligne et n'écrirait rien, sans erreur.
  IF (SELECT count(*) FROM plateforme.parametres_facteurs_co2) <> 5
     OR (SELECT count(*) FROM plateforme.parametres_mix_emballages) <> 7
     OR (SELECT count(*) FROM plateforme.parametres_facteurs_co2_ag) < 1
     OR (SELECT count(*) FROM plateforme.parametres_co2_divers) < 1 THEN
    RAISE EXCEPTION 'paramètres CO₂ invisibles au rôle de migration : rien n''a été corrigé';
  END IF;

  -- ── 1. Facteurs par flux (emballage : dérivé du mix, plus bas) ───────────
  SELECT jsonb_agg(to_jsonb(f) ORDER BY f.code_flux) INTO v_avant
  FROM plateforme.parametres_facteurs_co2 f;

  ALTER TABLE plateforme.parametres_facteurs_co2 DISABLE TRIGGER trg_audit_facteurs_co2;

  UPDATE plateforme.parametres_facteurs_co2 f
  SET fe_induit_kg_t = c.induit,
      fe_evite_kg_t  = c.evite,
      source_donnee  = c.source,
      date_maj       = now(),
      updated_at     = now()
  FROM (VALUES
    ('verre',           639.00, 1158.00, 639.00, 1158.00,
     'Base Carbone ADEME V23.6 · Emballages Verre Recyclage (34472/34473) ; énergie non revue'),
    ('carton',          670.00,  390.00, 992.00,  379.00,
     'Base Carbone ADEME V23.6 · Emballages Carton Recyclage (34480/34481) ; énergie non revue'),
    ('biodechet',        40.00,   77.00, 173.00,   12.00,
     'Base Carbone ADEME V23.6 · Déchets de cuisine Méthanisation (34636/34637)'),
    ('dechet_residuel', 380.00,  180.00, 374.00,  212.00,
     'Base Carbone ADEME V23.6 · OMR Incinération (34650/34651)')
  ) AS c(code, induit_0, evite_0, induit, evite, source)
  WHERE f.code_flux::text = c.code
    AND f.fe_induit_kg_t = c.induit_0
    AND f.fe_evite_kg_t = c.evite_0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n < 4 THEN
    RAISE NOTICE 'facteurs CO₂ : % ligne(s) sur 4 corrigée(s) ; les autres ne portaient plus les valeurs attendues, conservées', v_n;
  END IF;

  -- ── 2. Mix emballages : facteurs par matériau (parts inchangées) ────────
  SELECT jsonb_agg(to_jsonb(m) ORDER BY m.code_materiau) INTO v_mix_avant
  FROM plateforme.parametres_mix_emballages m;

  IF (SELECT count(*) FROM plateforme.parametres_mix_emballages m
      JOIN (VALUES
        ('carton_papier', 670.00,   390.00),
        ('pet',           400.00,  1400.00),
        ('pehd',          350.00,  1200.00),
        ('acier',          75.00,  1600.00),
        ('alu',           200.00, 10000.00),
        ('briques',       670.00,   390.00),
        ('autres',        380.00,   180.00)
      ) AS o(code, induit, evite)
        ON m.code_materiau::text = o.code
       AND m.fe_induit_kg_t = o.induit
       AND m.fe_evite_kg_t = o.evite) = 7
  THEN
    -- Validation Σ = 100 et recalcul de la ligne emballage différés à la fin
    -- (même mécanisme que rpc_maj_mix_emballages).
    PERFORM set_config('savr.mix_batch', '1', true);
    ALTER TABLE plateforme.parametres_mix_emballages DISABLE TRIGGER trg_audit_mix_emballages;

    UPDATE plateforme.parametres_mix_emballages m
    SET fe_induit_kg_t = c.induit,
        fe_evite_kg_t  = c.evite,
        source_donnee  = c.source,
        date_maj       = now(),
        updated_at     = now()
    FROM (VALUES
      ('carton_papier', 992.00,  379.00, 'Base Carbone ADEME · Emballages Carton Recyclage (34480/34481)'),
      ('pet',           662.00, 1741.00, 'Base Carbone ADEME · Emballages PET bouteilles Recyclage (34492/34493)'),
      ('pehd',          434.00, 1442.00, 'Base Carbone ADEME · Emballages PE bouteilles Recyclage (34522/34523)'),
      ('acier',         938.00, 2211.00, 'Base Carbone ADEME · approché : Déchets du bâtiment Métaux ferreux fin de vie moyenne'),
      ('alu',           873.00, 8432.00, 'Base Carbone ADEME · Emballages Aluminium Recyclage (34460/34461)'),
      ('briques',       992.00,  379.00, 'Base Carbone ADEME · approché : Emballages Carton Recyclage (34480/34481)'),
      ('autres',        374.00,  212.00, 'Base Carbone ADEME · OMR Incinération (34650/34651)')
    ) AS c(code, induit, evite, source)
    WHERE m.code_materiau::text = c.code;

    ALTER TABLE plateforme.parametres_mix_emballages ENABLE TRIGGER trg_audit_mix_emballages;
    PERFORM set_config('savr.mix_batch', '', true);

    IF (SELECT abs(sum(part_pct) - 100) FROM plateforme.parametres_mix_emballages
        WHERE actif) > 0.05 THEN
      RAISE EXCEPTION 'mix emballages : Σ part_pct ≠ 100 après correction';
    END IF;

    SELECT round(sum(part_pct / 100.0 * fe_induit_kg_t), 2),
           round(sum(part_pct / 100.0 * fe_evite_kg_t), 2)
      INTO v_induit, v_evite
    FROM plateforme.parametres_mix_emballages WHERE actif;

    UPDATE plateforme.parametres_facteurs_co2
    SET fe_induit_kg_t = v_induit,
        fe_evite_kg_t  = v_evite,
        source_donnee  = 'Dérivé parametres_mix_emballages (Base Carbone ADEME) ; énergie = estimation agrégée provisoire',
        date_maj       = now(),
        updated_at     = now()
    WHERE code_flux = 'emballage';
  ELSE
    RAISE NOTICE 'mix emballages : ne porte plus les valeurs attendues, conservé tel quel';
  END IF;

  SELECT jsonb_agg(to_jsonb(m) ORDER BY m.code_materiau) INTO v_mix_apres
  FROM plateforme.parametres_mix_emballages m;

  IF v_mix_apres IS DISTINCT FROM v_mix_avant THEN
    INSERT INTO plateforme.audit_log (action, table_name, old_values, new_values, motif)
    VALUES ('parametres_mix_emballages_correction', 'parametres_mix_emballages',
            jsonb_build_object('mix', v_mix_avant),
            jsonb_build_object('mix', v_mix_apres),
            v_motif);
  END IF;

  ALTER TABLE plateforme.parametres_facteurs_co2 ENABLE TRIGGER trg_audit_facteurs_co2;

  SELECT jsonb_agg(to_jsonb(f) ORDER BY f.code_flux) INTO v_apres
  FROM plateforme.parametres_facteurs_co2 f;

  IF v_apres IS DISTINCT FROM v_avant THEN
    INSERT INTO plateforme.audit_log (action, table_name, old_values, new_values, motif)
    VALUES ('parametres_facteurs_co2_correction', 'parametres_facteurs_co2',
            jsonb_build_object('facteurs', v_avant),
            jsonb_build_object('facteurs', v_apres),
            v_motif);
  END IF;

  -- ── 3. Anti-Gaspi : 2,5 → 2,04 kg CO₂e par repas ────────────────────────
  SELECT jsonb_agg(to_jsonb(a) ORDER BY a.cle) INTO v_ag_avant
  FROM plateforme.parametres_facteurs_co2_ag a;

  ALTER TABLE plateforme.parametres_facteurs_co2_ag DISABLE TRIGGER trg_audit_facteurs_co2_ag;

  UPDATE plateforme.parametres_facteurs_co2_ag
  SET facteur_co2_evite_par_repas_kg = 2.04,
      source_donnee = 'Base Carbone ADEME V23.6 · Repas moyen (20682)',
      date_maj      = now(),
      updated_at    = now()
  WHERE actif AND facteur_co2_evite_par_repas_kg = 2.5;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE NOTICE 'facteur CO₂ AG : ne vaut plus 2,5, conservé';
  END IF;

  ALTER TABLE plateforme.parametres_facteurs_co2_ag ENABLE TRIGGER trg_audit_facteurs_co2_ag;

  SELECT jsonb_agg(to_jsonb(a) ORDER BY a.cle) INTO v_ag_apres
  FROM plateforme.parametres_facteurs_co2_ag a;

  IF v_ag_apres IS DISTINCT FROM v_ag_avant THEN
    INSERT INTO plateforme.audit_log (action, table_name, old_values, new_values, motif)
    VALUES ('parametres_facteurs_co2_ag_correction', 'parametres_facteurs_co2_ag',
            jsonb_build_object('facteurs_ag', v_ag_avant),
            jsonb_build_object('facteurs_ag', v_ag_apres),
            v_motif);
  END IF;

  -- ── 4. Équivalences et paramètres divers (audit par leur déclencheur) ───
  UPDATE plateforme.parametres_co2_divers d
  SET valeur = c.valeur, description = c.description, updated_at = now()
  FROM (VALUES
    ('equiv_km_voiture_kgco2',      0.2180, 0.2560, 'Voiture motorisation moyenne 2023 (Base Carbone 43791)'),
    ('equiv_repas_boeuf_kgco2',     7.0000, 7.2600, 'Repas avec bœuf (Base Carbone 20689)'),
    ('fe_electricite_fr_co2_kwh',   0.0385, 0.0519, 'Électricité France 2024, mix moyen (Base Carbone 43642)'),
    ('fe_gaz_naturel_co2_kwh',      0.2045, 0.2390, 'Gaz naturel 2022, mix moyen (Base Carbone 37132)'),
    ('facteur_co2_biodechet_traite', 0.0030, 0.1400, 'Compostage industriel, par kg (Base Carbone 34638)')
  ) AS c(cle, valeur_0, valeur, description)
  WHERE d.cle = c.cle AND d.valeur = c.valeur_0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n < 5 THEN
    RAISE NOTICE 'paramètres divers : % ligne(s) sur 5 corrigée(s) ; les autres ne portaient plus les valeurs attendues, conservées', v_n;
  END IF;

  PERFORM set_config('savr.audit_motif', '', true);
END
$migration$;

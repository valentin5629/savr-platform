-- Facteurs CO₂ zéro déchet : valeurs du CDC à la place des valeurs provisoires
-- posées par le seed d'origine (20260611171642_plateforme_bloc8), et forfait
-- collecte ramené de 50 à 15 km.
--
-- Constat (revue écran E2E, 2026-10-20) : bloc8 a posé des facteurs provisoires
-- (ex. verre 10 / 300 kgCO₂e/t, déchet résiduel 500 / 0) étiquetés « ADEME Base
-- Carbone 2024 », différents de la table « Seed V1 » du CDC (§04 Data Model,
-- `parametres_facteurs_co2` et `parametres_mix_emballages`, arbitrage Val
-- 2026-06-04). Le déclencheur trg_recompute_emballage_fe était coupé pendant ce
-- seed : la ligne `emballage` n'a jamais été dérivée du mix (30 / 400).
-- Forfait collecte (`km_collecte_aller_retour`) : 15 km au lieu de 50, décision
-- Val 2026-10-20 (valeur provisoire, à ajuster plus tard).
--
-- Une valeur n'est remplacée que si elle est encore celle du seed d'origine :
-- un facteur déjà modifié par un admin (RPC tracée) est conservé (NOTICE).
-- Les libellés (`nom_flux`, `nom_materiau`) passent à ceux du CDC s'ils sont
-- encore ceux de bloc8.
-- Le mix n'est remplacé que si ses 7 lignes sont toutes d'origine (sinon
-- Σ part_pct = 100 ne tiendrait pas).
--
-- Traçabilité : les historiques `*_history` exigent un auteur (`modifie_par`
-- NOT NULL) qu'une migration n'a pas ; leurs déclencheurs sont suspendus le
-- temps des UPDATE (comme au seed bloc8) et la correction est inscrite dans
-- `audit_log` (valeurs avant / après + motif). Le forfait passe par son
-- déclencheur d'audit habituel (`audit_log`), avec le même motif.
--
-- Les collectes déjà clôturées gardent leurs valeurs figées
-- (R_co2_snapshot_fige) : aucune n'est recalculée ici.
--
-- Retour arrière : les lignes d'origine sont dans `audit_log` (actions
-- `parametres_facteurs_co2_correction` et `parametres_mix_emballages_correction`,
-- `old_values->'facteurs'` et `old_values->'mix'`). Les réécrire, déclencheurs
-- d'historique suspendus et `savr.mix_batch` = '1' comme ci-dessous, puis
-- remettre `km_collecte_aller_retour` à 50.

DO $migration$
DECLARE
  v_motif constant text :=
    'Correction des valeurs d''origine : facteurs CO₂ du CDC §04 (arbitrage Val '
    '2026-06-04), forfait collecte 15 km (décision Val 2026-10-20)';
  v_avant  jsonb;
  v_apres  jsonb;
  v_mix_avant jsonb;
  v_mix_apres jsonb;
  v_n      int;
  v_induit decimal(8,2);
  v_evite  decimal(8,2);
BEGIN
  PERFORM set_config('savr.audit_motif', v_motif, true);

  -- ── 1. Facteurs par flux (emballage : énergie seule, FE dérivés du mix) ──
  SELECT jsonb_agg(to_jsonb(f) ORDER BY f.code_flux) INTO v_avant
  FROM plateforme.parametres_facteurs_co2 f;

  ALTER TABLE plateforme.parametres_facteurs_co2 DISABLE TRIGGER trg_audit_facteurs_co2;

  UPDATE plateforme.parametres_facteurs_co2 f
  SET fe_induit_kg_t                = c.induit,
      fe_evite_kg_t                 = c.evite,
      energie_primaire_evitee_kwh_t = c.energie,
      source_donnee                 = c.source,
      date_maj                      = now(),
      updated_at                    = now()
  FROM (VALUES
    -- code, valeurs d'origine (induit, évité, énergie), valeurs CDC, source CDC
    ('verre',           10.00, 300.00,  400.00, 639.00, 1158.00,  4000.00,
     'Base Empreinte V23.6 / FEDEREC 2017'),
    ('carton',          25.00, 520.00, 1800.00, 670.00,  390.00, 10098.00,
     'Base Empreinte V23.6 / FEDEREC 2017'),
    ('biodechet',       20.00, 250.00,  800.00,  40.00,   77.00,     0.00,
     'Base Carbone (44 énergie + 33 digestat)'),
    ('dechet_residuel', 500.00,  0.00,    0.00, 380.00,  180.00,     0.00,
     'Base Empreinte V23.6 / MODECOM 2017 / ITOM 2014')
  ) AS c(code, induit_0, evite_0, energie_0, induit, evite, energie, source)
  WHERE f.code_flux::text = c.code
    AND f.fe_induit_kg_t = c.induit_0
    AND f.fe_evite_kg_t = c.evite_0
    AND f.energie_primaire_evitee_kwh_t = c.energie_0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n < 4 THEN
    RAISE NOTICE 'facteurs CO₂ : % ligne(s) sur 4 corrigée(s) ; les autres ne portaient plus les valeurs d''origine, conservées', v_n;
  END IF;

  UPDATE plateforme.parametres_facteurs_co2 f
  SET nom_flux = c.nom, updated_at = now()
  FROM (VALUES
    ('carton',          'Cartons',                   'Carton'),
    ('biodechet',       'Biodéchets',                'Biodéchets (méthanisation)'),
    ('emballage',       'Emballages',                'Emballages ménagers (mix)'),
    ('dechet_residuel', 'Déchet résiduel',           'Déchet résiduel (OMR)')
  ) AS c(code, nom_0, nom)
  WHERE f.code_flux::text = c.code AND f.nom_flux = c.nom_0;

  UPDATE plateforme.parametres_facteurs_co2
  SET energie_primaire_evitee_kwh_t = 7000.00,
      source_donnee = 'Dérivé parametres_mix_emballages ; énergie = estimation agrégée provisoire',
      date_maj      = now(),
      updated_at    = now()
  WHERE code_flux = 'emballage'
    AND energie_primaire_evitee_kwh_t = 1200.00;

  -- ── 2. Mix emballages (7 matériaux, tous d'origine ou aucun) ─────────────
  SELECT jsonb_agg(to_jsonb(m) ORDER BY m.code_materiau) INTO v_mix_avant
  FROM plateforme.parametres_mix_emballages m;

  IF (SELECT count(*) FROM plateforme.parametres_mix_emballages m
      JOIN (VALUES
        ('carton_papier', 25.00, 25.00, 520.00),
        ('pet',           20.00, 80.00, 450.00),
        ('pehd',          15.00, 80.00, 380.00),
        ('acier',          5.00, 35.00, 600.00),
        ('alu',           10.00, 40.00, 900.00),
        ('briques',        5.00, 30.00, 400.00),
        ('autres',        20.00, 50.00, 200.00)
      ) AS o(code, part, induit, evite)
        ON m.code_materiau::text = o.code
       AND m.part_pct = o.part
       AND m.fe_induit_kg_t = o.induit
       AND m.fe_evite_kg_t = o.evite) = 7
  THEN
    -- Validation Σ = 100 et recalcul de la ligne emballage différés à la fin
    -- (même mécanisme que rpc_maj_mix_emballages).
    PERFORM set_config('savr.mix_batch', '1', true);
    ALTER TABLE plateforme.parametres_mix_emballages DISABLE TRIGGER trg_audit_mix_emballages;

    UPDATE plateforme.parametres_mix_emballages m
    SET part_pct       = c.part,
        fe_induit_kg_t = c.induit,
        fe_evite_kg_t  = c.evite,
        source_donnee  = c.source,
        date_maj       = now(),
        updated_at     = now()
    FROM (VALUES
      ('carton_papier', 60.00, 670.00,   390.00, 'FEDEREC 2017/2023'),
      ('pet',           20.00, 400.00,  1400.00, 'FEDEREC 2017/2023'),
      ('pehd',          10.00, 350.00,  1200.00, 'FEDEREC 2017/2023'),
      ('acier',          3.00,  75.00,  1600.00, 'FEDEREC ; SNFBM/Empac'),
      ('alu',            5.00, 200.00, 10000.00, 'FEDEREC ; Metal Packaging Europe'),
      ('briques',        1.00, 670.00,   390.00, 'Citeo / Alliance Carton Nature'),
      ('autres',         1.00, 380.00,   180.00, 'Base Carbone OMR')
    ) AS c(code, part, induit, evite, source)
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
        date_maj       = now(),
        updated_at     = now()
    WHERE code_flux = 'emballage';
  ELSE
    RAISE NOTICE 'mix emballages : ne porte plus les valeurs d''origine, conservé tel quel';
  END IF;

  -- Libellés du mix (sans effet sur Σ part_pct ni sur la ligne emballage :
  -- validation et recalcul suspendus le temps de l'UPDATE).
  PERFORM set_config('savr.mix_batch', '1', true);
  UPDATE plateforme.parametres_mix_emballages m
  SET nom_materiau = c.nom, updated_at = now()
  FROM (VALUES
    ('carton_papier', 'Carton / papier',  'Carton-papier'),
    ('pehd',          'PEHD',             'PEhd'),
    ('autres',        'Autres matériaux', 'Autres / refus (→ OMR)')
  ) AS c(code, nom_0, nom)
  WHERE m.code_materiau::text = c.code AND m.nom_materiau = c.nom_0;
  PERFORM set_config('savr.mix_batch', '', true);

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

  -- ── 3. Forfait collecte : 50 → 15 km (audit_log par son déclencheur) ─────
  UPDATE plateforme.parametres_co2_divers
  SET valeur = 15, updated_at = now()
  WHERE cle = 'km_collecte_aller_retour' AND valeur = 50;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE NOTICE 'forfait collecte : ne vaut plus 50 km, conservé';
  END IF;

  -- Contrôle de fin, en forme positive : sous RLS forcée, un rôle sans
  -- BYPASSRLS ne verrait aucune ligne et n'écrirait rien, sans erreur.
  IF (SELECT count(*) FROM plateforme.parametres_facteurs_co2) <> 5
     OR (SELECT count(*) FROM plateforme.parametres_mix_emballages) <> 7
     OR (SELECT count(*) FROM plateforme.parametres_co2_divers
         WHERE cle = 'km_collecte_aller_retour') <> 1 THEN
    RAISE EXCEPTION 'paramètres CO₂ invisibles au rôle de migration : rien n''a été corrigé';
  END IF;

  PERFORM set_config('savr.audit_motif', '', true);
END
$migration$;

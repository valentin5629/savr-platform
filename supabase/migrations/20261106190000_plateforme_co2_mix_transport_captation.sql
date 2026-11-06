-- Paramètres CO₂ alignés sur le document de méthode envoyé à VIPARIS
-- (décision Val 2026-11-06) :
--   1. mix emballages : refus de tri 1 % → 30 %, les six matériaux recyclables
--      réduits dans la même proportion (× 70/99) ; facteurs inchangés ;
--   2. forfait de collecte : 15 → 25 km aller-retour ;
--   3. taux de captation : verre 0,90 → 0,95, carton 0,80 → 0,90
--      (biodéchets 0,85 et emballages 0,60 inchangés).
--
-- Une valeur n'est remplacée que si elle porte encore la valeur attendue :
-- une valeur déjà modifiée par un admin est conservée (NOTICE). Le mix n'est
-- remplacé que si ses 7 parts sont toutes celles attendues.
--
-- Traçabilité : les historiques `*_history` exigent un auteur qu'une migration
-- n'a pas ; leurs déclencheurs sont suspendus le temps des UPDATE et l'avant /
-- après est inscrit dans `audit_log` avec le motif. Le forfait passe par le
-- déclencheur d'audit habituel de `parametres_co2_divers`.
--
-- Les collectes déjà calculées gardent leurs valeurs figées
-- (R_co2_snapshot_fige) : aucune n'est recalculée ici.
--
-- Retour arrière : valeurs d'origine dans `audit_log` (actions
-- `parametres_mix_emballages_correction`, `parametres_facteurs_co2_correction`,
-- `parametres_taux_recyclage_correction`) et dans l'audit de
-- `parametres_co2_divers`.

DO $migration$
DECLARE
  v_motif constant text :=
    'Mix emballages (30 % de refus), forfait 25 km, captation verre 95 % et carton 90 % (décision Val 2026-11-06)';
  v_avant     jsonb;
  v_apres     jsonb;
  v_mix_avant jsonb;
  v_mix_apres jsonb;
  v_tx_avant  jsonb;
  v_tx_apres  jsonb;
  v_n         int;
  v_induit    decimal(8,2);
  v_evite     decimal(8,2);
BEGIN
  PERFORM set_config('savr.audit_motif', v_motif, true);

  -- Contrôle d'entrée, en forme positive : sous RLS forcée, un rôle sans
  -- BYPASSRLS ne verrait aucune ligne et n'écrirait rien, sans erreur.
  IF (SELECT count(*) FROM plateforme.parametres_facteurs_co2) <> 5
     OR (SELECT count(*) FROM plateforme.parametres_mix_emballages) <> 7
     OR (SELECT count(*) FROM plateforme.parametres_taux_recyclage) < 4
     OR (SELECT count(*) FROM plateforme.parametres_co2_divers
         WHERE cle = 'km_collecte_aller_retour') <> 1 THEN
    RAISE EXCEPTION 'paramètres CO₂ invisibles au rôle de migration : rien n''a été corrigé';
  END IF;

  -- ── 1. Mix emballages : parts (facteurs inchangés) ───────────────────────
  SELECT jsonb_agg(to_jsonb(f) ORDER BY f.code_flux) INTO v_avant
  FROM plateforme.parametres_facteurs_co2 f;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY m.code_materiau) INTO v_mix_avant
  FROM plateforme.parametres_mix_emballages m;

  IF (SELECT count(*) FROM plateforme.parametres_mix_emballages m
      JOIN (VALUES
        ('carton_papier', 60.00), ('pet', 20.00), ('pehd', 10.00),
        ('alu', 5.00), ('acier', 3.00), ('briques', 1.00), ('autres', 1.00)
      ) AS o(code, part)
        ON m.code_materiau::text = o.code AND m.part_pct = o.part) = 7
  THEN
    -- Validation Σ = 100 et recalcul de la ligne emballage différés à la fin
    -- (même mécanisme que rpc_maj_mix_emballages).
    PERFORM set_config('savr.mix_batch', '1', true);
    ALTER TABLE plateforme.parametres_mix_emballages DISABLE TRIGGER trg_audit_mix_emballages;

    UPDATE plateforme.parametres_mix_emballages m
    SET part_pct   = c.part,
        date_maj   = now(),
        updated_at = now()
    FROM (VALUES
      ('carton_papier', 42.42), ('pet', 14.14), ('pehd', 7.07),
      ('alu', 3.54), ('acier', 2.12), ('briques', 0.71), ('autres', 30.00)
    ) AS c(code, part)
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

    ALTER TABLE plateforme.parametres_facteurs_co2 DISABLE TRIGGER trg_audit_facteurs_co2;
    UPDATE plateforme.parametres_facteurs_co2
    SET fe_induit_kg_t = v_induit,
        fe_evite_kg_t  = v_evite,
        date_maj       = now(),
        updated_at     = now()
    WHERE code_flux = 'emballage';
    ALTER TABLE plateforme.parametres_facteurs_co2 ENABLE TRIGGER trg_audit_facteurs_co2;
  ELSE
    RAISE NOTICE 'mix emballages : ne porte plus les parts attendues, conservé tel quel';
  END IF;

  SELECT jsonb_agg(to_jsonb(m) ORDER BY m.code_materiau) INTO v_mix_apres
  FROM plateforme.parametres_mix_emballages m;
  SELECT jsonb_agg(to_jsonb(f) ORDER BY f.code_flux) INTO v_apres
  FROM plateforme.parametres_facteurs_co2 f;

  IF v_mix_apres IS DISTINCT FROM v_mix_avant THEN
    INSERT INTO plateforme.audit_log (action, table_name, old_values, new_values, motif)
    VALUES ('parametres_mix_emballages_correction', 'parametres_mix_emballages',
            jsonb_build_object('mix', v_mix_avant),
            jsonb_build_object('mix', v_mix_apres),
            v_motif);
  END IF;
  IF v_apres IS DISTINCT FROM v_avant THEN
    INSERT INTO plateforme.audit_log (action, table_name, old_values, new_values, motif)
    VALUES ('parametres_facteurs_co2_correction', 'parametres_facteurs_co2',
            jsonb_build_object('facteurs', v_avant),
            jsonb_build_object('facteurs', v_apres),
            v_motif);
  END IF;

  -- ── 2. Forfait de collecte : 15 → 25 km (audit par son déclencheur) ─────
  UPDATE plateforme.parametres_co2_divers
  SET valeur = 25, updated_at = now()
  WHERE cle = 'km_collecte_aller_retour' AND valeur = 15;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE NOTICE 'forfait collecte : ne vaut plus 15 km, conservé';
  END IF;

  -- ── 3. Taux de captation : verre 0,95, carton 0,90 ──────────────────────
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.code_filiere) INTO v_tx_avant
  FROM plateforme.parametres_taux_recyclage t;

  ALTER TABLE plateforme.parametres_taux_recyclage DISABLE TRIGGER trg_audit_taux_recyclage;

  UPDATE plateforme.parametres_taux_recyclage t
  SET taux_captation = c.taux,
      date_maj       = now(),
      updated_at     = now()
  FROM (VALUES ('verre', 0.9000, 0.9500), ('carton', 0.8000, 0.9000))
    AS c(code, taux_0, taux)
  WHERE t.code_filiere::text = c.code AND t.taux_captation = c.taux_0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n < 2 THEN
    RAISE NOTICE 'taux de captation : % ligne(s) sur 2 corrigée(s) ; les autres ne portaient plus les valeurs attendues, conservées', v_n;
  END IF;

  ALTER TABLE plateforme.parametres_taux_recyclage ENABLE TRIGGER trg_audit_taux_recyclage;

  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.code_filiere) INTO v_tx_apres
  FROM plateforme.parametres_taux_recyclage t;

  IF v_tx_apres IS DISTINCT FROM v_tx_avant THEN
    INSERT INTO plateforme.audit_log (action, table_name, old_values, new_values, motif)
    VALUES ('parametres_taux_recyclage_correction', 'parametres_taux_recyclage',
            jsonb_build_object('taux', v_tx_avant),
            jsonb_build_object('taux', v_tx_apres),
            v_motif);
  END IF;

  PERFORM set_config('savr.audit_motif', '', true);
END
$migration$;

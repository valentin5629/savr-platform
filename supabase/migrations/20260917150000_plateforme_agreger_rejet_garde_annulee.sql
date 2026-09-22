-- =============================================================================
-- Agrégation terminale : un rejet transporteur ne requalifie plus une collecte
-- annulée ou en demande d'annulation.
-- =============================================================================
-- SOURCE. §05 R_statut_collecte_multi_tournees (« tous les tours CANCELED/KO →
-- rejetee_par_prestataire », jamais de régression d'un état terminal) et §08
-- §3bis.6/3bis.7. Arbitrage Val 2026-09-17 pour `annulation_demandee` (cas non
-- couvert par le CDC) : la demande en cours est conservée — aucune écriture sur
-- la collecte, pas d'alerte « réattribution requise ». L'Admin tranche la
-- demande ; s'il la refuse, la collecte doit pouvoir revenir en `validee`.
--
-- DÉFAUT CORRIGÉ. Mesuré sur la base locale (transaction annulée) : collecte
-- `annulee` + toutes ses tournées `annulee` → fn_agreger_terminal_collecte
-- écrivait `rejetee_par_prestataire` et posait l'alerte Admin
-- `collecte_rejetee_par_prestataire`. La garde de l'UPDATE était une liste
-- d'exclusion (`NOT IN (realisee, cloturee, rejetee_par_prestataire,
-- realisee_sans_collecte)`) qui laissait passer `annulee` et
-- `annulation_demandee`. Chemin réel : annulation Savr (E3) puis ordre MTS-1
-- remonté CANCELED/KO au polling (refus transporteur concomitant, DELETE refusé
-- hors fenêtre, ou ordre supprimé encore listé) → adapter → cette fonction.
--
-- CE QUI CHANGE. La garde devient une liste positive, symétrique de la branche
-- `realisee` : `statut IN (programmee, validee, en_cours)` — les seuls statuts
-- d'une collecte en cours d'exécution. `brouillon` n'a jamais de tournée. Le
-- reste du corps est recopié à l'identique de 20260702000200.
--
-- NATURE. CREATE OR REPLACE d'une fonction SECURITY DEFINER existante. Droits
-- réaffirmés et fermés : EXECUTE retiré à PUBLIC, anon et authenticated, accordé
-- au seul service_role. Aucune table, colonne, policy ni donnée touchée.
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- Ré-appliquer le CREATE OR REPLACE de
-- 20260702000200_plateforme_r16a_agreger_alerte_rejet.sql (même signature).
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_agreger_terminal_collecte(
  p_collecte_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_nb_demande    integer;
  v_statut        text;
  v_nb_terminee   integer;
  v_nb_annulee    integer;
  v_total_term    integer;
  v_rejet_nb      integer;
BEGIN
  -- Lock la ligne collecte (idempotence concurrente R5/R6 CLAUDE.md §4) + lit le
  -- statut courant sous le verrou (sert de garde anti-écrasement post-clôture).
  SELECT nb_camions_demande, statut
  INTO   v_nb_demande, v_statut
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

  -- Au moins 1 tour OK/PARTIAL → realisee (realisee_at figé : embargo H+24 stable)
  IF v_nb_terminee > 0 THEN
    -- Dérivation collecte_flux (BL-P0-01) : recalcul complet par flux depuis
    -- pesees_tournees, restreint aux tournées 'terminee' (OK/PARTIAL). Les tours
    -- 'annulee' (CANCELED/KO) sont exclus (BL-P1-RM-06). UPSERT idempotent : seul
    -- poids_reel_kg est dérivé (equivalent_roll/nb_bacs préservés). Écrasement
    -- interdit si la collecte est déjà cloturee (§04 + §08 3bis.7).
    IF v_statut <> 'cloturee' THEN
      INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
      SELECT p_collecte_id, pt.flux_id, SUM(pt.poids_kg)
      FROM   plateforme.pesees_tournees pt
      JOIN   plateforme.collecte_tournees ct ON ct.tournee_id = pt.tournee_id
      JOIN   plateforme.tournees tr          ON tr.id        = pt.tournee_id
      WHERE  ct.collecte_id = p_collecte_id
        AND  tr.statut      = 'terminee'
      GROUP BY pt.flux_id
      ON CONFLICT (collecte_id, flux_id)
      DO UPDATE SET poids_reel_kg = EXCLUDED.poids_reel_kg,
                    updated_at    = now();
    END IF;

    UPDATE plateforme.collectes
    SET
      statut      = 'realisee',
      realisee_at = COALESCE(realisee_at, now())
    WHERE id      = p_collecte_id
      AND statut  IN ('programmee', 'validee', 'en_cours');

    RETURN 'realisee';
  END IF;

  -- Tous annulés → rejetee_par_prestataire, seulement pour une collecte en cours
  -- d'exécution. Une collecte annulée ou en demande d'annulation n'est pas
  -- requalifiée (arbitrage Val 2026-09-17), un état terminal ne régresse pas.
  UPDATE plateforme.collectes
  SET statut = 'rejetee_par_prestataire'
  WHERE id   = p_collecte_id
    AND statut IN ('programmee', 'validee', 'en_cours');

  -- RM-07 : alerte Admin in-app UNIQUEMENT sur la transition effective (ROW_COUNT).
  -- Signal « réattribution requise » — retour file Ops-driven (décision Val 2026-07-02).
  GET DIAGNOSTICS v_rejet_nb = ROW_COUNT;
  IF v_rejet_nb > 0 THEN
    PERFORM plateforme.f_upsert_alerte_admin(
      'collecte_rejetee_par_prestataire',
      'Collecte rejetée par le transporteur',
      'Tous les camions ont été refusés/annulés (CANCELED/KO) pour la collecte '
        || p_collecte_id::text || '. Réattribution ou reprogrammation requise.',
      'collectes',
      p_collecte_id
    );
  END IF;

  RETURN 'rejetee_par_prestataire';
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_agreger_terminal_collecte(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.fn_agreger_terminal_collecte(uuid) TO service_role;

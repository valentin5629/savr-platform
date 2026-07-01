-- =============================================================================
-- R16a (BL-P1-RM-07) — Alerte Admin sur rejet total transporteur (tous tours KO).
-- =============================================================================
-- Corps de base : DERNIÈRE def = 20260624130000 (R1, dérivation collecte_flux).
-- Reproduit VERBATIM ; seul ajout : sur la transition effective vers
-- `rejetee_par_prestataire` (tous les tours CANCELED/KO), émission d'une ALERTE
-- ADMIN in-app (`f_upsert_alerte_admin`) — avant, ce chemin était silencieux.
--
-- Décision Val 2026-07-02 (R16, cf. _Divergences/M1.8_20260702.md) : « alerte Admin
-- seule, non destructif ». On CONSERVE `collectes.statut = 'rejetee_par_prestataire'`
-- (visibilité dashboard, décision Val 2026-06-15) et on NE mute PAS l'attribution
-- (pas de DELETE, pas de reset statut→programmee). Le « retour file » est Ops-driven :
-- l'Ops réattribue/reprogramme depuis l'alerte. La file /pending exige statut=
-- 'programmee' → une remise auto en file contredirait la visibilité dashboard.
--
-- L'alerte n'est émise que si l'UPDATE a réellement transité (ROW_COUNT > 0) →
-- idempotent : un poll concurrent qui ne transitionne rien ne re-alerte pas
-- (f_upsert_alerte_admin dédup aussi sur alerte ouverte identique, double filet).
--
-- ⚠ CREATE OR REPLACE réinitialise search_path → on RÉ-INCLUT `SET search_path`.
--
-- ── ROLLBACK (down-migration, DoD §rollback) ────────────────────────────────
-- Ré-appliquer le corps de fn_agreger_terminal_collecte tel qu'AVANT R16a, c.-à-d.
-- le CREATE OR REPLACE de 20260624130000_plateforme_r1_collecte_flux_derive.sql
-- (même signature, sans l'alerte f_upsert_alerte_admin sur le chemin rejet) :
--   psql -f supabase/migrations/20260624130000_plateforme_r1_collecte_flux_derive.sql
-- Effet : la transition rejetee_par_prestataire redevient silencieuse (pas d'alerte
-- Admin) ; dérivation collecte_flux + transitions inchangées. Non destructif.
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

  -- Tous annulés → rejetee_par_prestataire
  -- 'rejetee_par_prestataire' est dans collecte_statut_enum depuis migration 20260615115900.
  UPDATE plateforme.collectes
  SET statut = 'rejetee_par_prestataire'
  WHERE id   = p_collecte_id
    AND statut NOT IN ('realisee', 'cloturee', 'rejetee_par_prestataire',
                       'realisee_sans_collecte');

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

-- Droits inchangés (REVOKE PUBLIC + GRANT service_role posés dès 20260615100000,
-- conservés par CREATE OR REPLACE).

-- =============================================================================
-- R1 (BL-P0-01 + BL-P1-RM-06) — Dérivation collecte_flux depuis pesees_tournees.
-- =============================================================================
-- Avant ce lot, fn_agreger_terminal_collecte transitionnait le statut mais ne
-- dérivait JAMAIS collecte_flux depuis pesees_tournees → poids_reel_kg restait
-- NULL en prod → bordereau J+1 sans tonnage, registre/CO2 vides.
--
-- Fix (CDC §04 Data Model « collecte_flux dérivée » + Interface logistique_provider
-- §3 « agrégation terminale » + §05 R_statut_collecte_multi_tournees) :
--   Dans la transaction terminale (tous les rangs 1..N terminaux, FOR UPDATE déjà
--   pris sur collectes), quand ≥1 tour est OK/PARTIAL (tournees.statut='terminee'),
--   recalcule l'agrégat COMPLET par flux depuis pesees_tournees — restreint aux
--   tournées 'terminee' (OK/PARTIAL) — et écrit collecte_flux par UPSERT idempotent
--   ON CONFLICT (collecte_id, flux_id). Les tours CANCELED/KO (statut 'annulee')
--   sont EXCLUS de la somme (BL-P1-RM-06 : realisee sur les seules pesées des tours
--   non-KO). Écrasement interdit après clôture (§04 + §08 3bis.7).
--
-- Pas d'incrément : recalcul complet à chaque agrégation terminale (re-poll sûr).
--
-- ⚠ CREATE OR REPLACE remplace TOUTES les propriétés de la fonction : le
-- `SET search_path = plateforme, pg_catalog` (durcissement 20260623140000) est
-- ré-inclus dans l'en-tête, sinon il serait réinitialisé.
-- Migration NON destructive (CREATE OR REPLACE — droits REVOKE PUBLIC + GRANT
-- service_role conservés par CREATE OR REPLACE).
--
-- ── ROLLBACK (down-migration, DoD §rollback) ────────────────────────────────
-- Reverter = ré-appliquer le corps de la fonction tel qu'AVANT R1, c.-à-d. le
-- contenu de `20260615120000_plateforme_m1_8_fix_a1_a2.sql` (CREATE OR REPLACE
-- de la même signature, SANS le bloc de dérivation collecte_flux), PUIS
-- ré-appliquer le durcissement search_path :
--   psql -f supabase/migrations/20260615120000_plateforme_m1_8_fix_a1_a2.sql
--   ALTER FUNCTION plateforme.fn_agreger_terminal_collecte(uuid)
--     SET search_path = plateforme, pg_catalog;
-- Effet : la transition de statut reste fonctionnelle ; seule la dérivation de
-- collecte_flux est désactivée (retour à l'état pré-R1, poids_reel_kg NULL).
-- Aucune donnée n'est perdue (collecte_flux déjà dérivée reste en place).
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

  RETURN 'rejetee_par_prestataire';
END;
$$;

-- Droits inchangés (REVOKE PUBLIC + GRANT service_role posés dès 20260615100000,
-- conservés par CREATE OR REPLACE).

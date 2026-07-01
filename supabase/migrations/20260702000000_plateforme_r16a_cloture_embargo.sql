-- =============================================================================
-- R16a (BL-P1-RM-01) — Clôture automatique realisee → cloturee après embargo H+24.
-- =============================================================================
-- Avant ce lot, AUCUN code runtime n'écrivait `collectes.statut = 'cloturee'`
-- (uniquement des WHERE / vues / un mock de test). Toute la chaîne post-clôture
-- était donc MORTE en prod :
--   - batchs J+1 (bordereau/rapport ZD + attestation AG) filtrent statut='cloturee'
--     ET realisee_at + 24h <= now() → 0 ligne trouvée → aucun document généré ;
--   - triggers CO₂ / taux de recyclage figent leurs snapshots sur `→ cloturee` ;
--   - registre réglementaire = collectes `cloturee` (ZD) → vide.
--
-- Fix (§05 §4 transition `realisee → cloturee` + embargo H+24 §05 l.483 / §12 §1.2) :
--   RPC `fn_cloturer_collectes_embargo()` appelée par le cron `cloture-embargo`,
--   qui passe `realisee → cloturee` UNIQUEMENT quand `realisee_at + 24h <= now()`
--   (l'embargo protège les snapshots CO₂/taux/attestation figés sur `→ cloturee`).
--   La transition est 100 % automatique, sans action Admin.
--
--   `realisee_sans_collecte` (AG, aucun invendu) est un état terminal DISTINCT qui
--   NE transitionne PAS vers `cloturee` : le batch attestation AG l'exclut justement
--   via `.eq('statut','cloturee')` (pas d'attestation sans repas). On ne le clôture
--   donc pas ici.
--
-- Divergence tracée : §05 l.244 dit « clôture immédiate » — le mot « immédiate »
-- est incohérent avec l'embargo H+24 (cf. _Divergences/M1.4_20260702.md). Suivi
-- du backlog + Gherkin BL-P1-RM-01 « realisee + embargo H+24 → cloturee ».
--
-- ── ROLLBACK (down-migration, DoD §rollback) ────────────────────────────────
--   DROP FUNCTION IF EXISTS plateforme.fn_cloturer_collectes_embargo();
--   + retirer le cron `/api/cron/cloture-embargo` de packages/plateforme/vercel.json.
-- Objet nouveau (aucune version antérieure) → drop suffit. Effet : plus de clôture
-- auto (les collectes restent `realisee`, batchs J+1 en attente) — aucune perte de
-- données. Le template email et les colonnes existantes ne sont pas touchés.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_cloturer_collectes_embargo()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_nb integer;
BEGIN
  -- Clôture idempotente : la garde `statut = 'realisee'` rend l'appel rejouable
  -- (un 2e run concurrent ne trouve plus la ligne). Chaque UPDATE déclenche les
  -- triggers AFTER UPDATE sur `collectes` (CO₂ / taux / attestation) qui figent
  -- leurs snapshots — l'embargo H+24 garantit qu'ils ne figent pas trop tôt.
  UPDATE plateforme.collectes
  SET statut = 'cloturee'
  WHERE statut = 'realisee'
    AND realisee_at IS NOT NULL
    AND realisee_at + interval '24 hours' <= now();

  GET DIAGNOSTICS v_nb = ROW_COUNT;
  RETURN v_nb;
END;
$$;

REVOKE ALL ON FUNCTION plateforme.fn_cloturer_collectes_embargo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_cloturer_collectes_embargo() TO service_role;

COMMENT ON FUNCTION plateforme.fn_cloturer_collectes_embargo() IS
  'BL-P1-RM-01 — clôture auto realisee → cloturee après embargo H+24 (realisee_at + 24h <= now()). Appelée par le cron cloture-embargo. Retourne le nombre de collectes clôturées.';

-- =============================================================================
-- Fix Lot C — C5 : verrouiller search_path des fonctions SECURITY DEFINER
-- =============================================================================
-- Plusieurs fonctions SECURITY DEFINER n'avaient PAS de `SET search_path`
-- verrouillé (CWE-426 : search-path hijack théorique). Toutes leurs voisines ont
-- été durcies ; on aligne les retardataires. Les corps référencent uniquement des
-- objets QUALIFIÉS (plateforme.*, shared.*, auth.jwt(), pg_catalog) → l'ALTER ne
-- change aucun comportement, c'est du durcissement pur.
--
-- C5 (liste du brief) : f_collecte_visible, f_collecte_editable,
--   f_dechets_labo_estimes (plateforme) + f_fichier_visible (shared).
-- + Dette signalée par la revue sécurité Lot A : les 3 fonctions outbox
--   (fn_claim_outbox_batch, fn_result_outbox, fn_reap_outbox_claims) n'ont jamais
--   eu de search_path → même durcissement ici (même thème).
-- =============================================================================

ALTER FUNCTION plateforme.f_collecte_visible(uuid)
  SET search_path = plateforme, pg_catalog;

ALTER FUNCTION plateforme.f_collecte_editable(uuid)
  SET search_path = plateforme, pg_catalog;

ALTER FUNCTION plateforme.f_dechets_labo_estimes(uuid)
  SET search_path = plateforme, pg_catalog;

ALTER FUNCTION shared.f_fichier_visible(text, uuid)
  SET search_path = shared, plateforme, pg_catalog;

-- Dette Lot A (revue sécurité) — fonctions outbox SECURITY DEFINER
ALTER FUNCTION plateforme.fn_claim_outbox_batch(integer, interval)
  SET search_path = plateforme, pg_catalog;

ALTER FUNCTION plateforme.fn_result_outbox(uuid, text, text, text, timestamptz, boolean)
  SET search_path = plateforme, pg_catalog;

ALTER FUNCTION plateforme.fn_reap_outbox_claims()
  SET search_path = plateforme, pg_catalog;

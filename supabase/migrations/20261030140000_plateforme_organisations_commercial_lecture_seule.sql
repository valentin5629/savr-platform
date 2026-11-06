-- =============================================================================
-- Mon organisation en lecture seule pour le commercial traiteur (Val 2026-10-30).
--
-- Retour sur la décision du 2026-09-28 (20260928100000) qui ouvrait au
-- commercial l'édition des informations légales (raison sociale, SIRET,
-- adresse). Désormais seul le manager modifie son organisation ; le commercial
-- la lit (policy org_commercial_select, inchangée).
--
-- Migration de FERMETURE (CLAUDE.md §12 pt 2bis) : retrait d'une policy UPDATE,
-- aucune ouverture. Sans policy UPDATE pour son rôle, un UPDATE du commercial
-- sur `organisations` ne touche aucune ligne (route PATCH réservée au manager
-- en amont). Le trigger trg_block_org_gestionnaire_cols_update garde sa liste
-- blanche pour le commercial : elle ne sert plus, mais ne rouvre rien.
-- =============================================================================

DROP POLICY IF EXISTS org_commercial_update ON plateforme.organisations;

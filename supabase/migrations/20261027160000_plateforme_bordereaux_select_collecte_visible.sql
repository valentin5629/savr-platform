-- Bordereau ZD lisible par tous ceux qui voient la collecte (décision Val 2026-10-27).
--
-- Écart corrigé : le rapport de recyclage (rr_select), le PDF du bordereau
-- (shared.f_fichier_visible) et le registre (v_registre_dechets) suivent
-- f_collecte_visible, alors que la ligne bordereaux_savr ne s'ouvrait qu'au
-- programmateur de rôle traiteur ou agence, au lieu, au client organisateur et
-- au staff. Deux profils voyaient le registre et le rapport sans pouvoir lire le
-- bordereau :
--   - le traiteur opérationnel désigné par un autre programmateur, pourtant
--     producteur juridique du déchet (raison sociale imprimée sur le bordereau,
--     obligation R541-43) ;
--   - le gestionnaire de lieux qui programme une collecte hors de ses lieux.
--
-- Élargissement d'accès validé explicitement par Val le 2026-10-27 (CLAUDE.md
-- §12, condition 2bis). Lecture seule : aucune policy d'écriture ajoutée,
-- INSERT / UPDATE restent réservés à l'admin, aucune policy DELETE.
-- Les policies existantes sont gardées (permissives, combinées en OU) : elles
-- deviennent des sous-cas de celle-ci, les retirer n'apporterait rien.

BEGIN;

CREATE POLICY bord_collecte_visible_select ON plateforme.bordereaux_savr
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (plateforme.f_collecte_visible(collecte_id));

COMMENT ON POLICY bord_collecte_visible_select ON plateforme.bordereaux_savr IS
  'Lecture du bordereau par tous ceux qui voient la collecte (f_collecte_visible), '
  'comme le rapport, le PDF et le registre. Décision Val 2026-10-27.';

COMMIT;

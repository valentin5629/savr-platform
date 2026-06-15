-- M2.5 correctif RLS — aligne sur le pattern canonique auth.jwt()->>'role'
-- (cf. f_is_staff() dans 0_4a_helpers — revue reviewer-rls-securite B1/B2).
-- Ajoute policies ops_savr et corrige le subquery par jwt claim.

-- Supprimer les 3 policies de la migration précédente (mauvais pattern)
DROP POLICY IF EXISTS "admin_savr_select_everest_missions" ON plateforme.everest_missions;
DROP POLICY IF EXISTS "admin_savr_insert_everest_missions" ON plateforme.everest_missions;
DROP POLICY IF EXISTS "admin_savr_update_everest_missions" ON plateforme.everest_missions;

-- admin_savr : accès complet (monitoring + création manuelle + failover Ops si route élevée)
CREATE POLICY "admin_savr_select_everest_missions"
  ON plateforme.everest_missions
  FOR SELECT TO authenticated
  USING (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY "admin_savr_insert_everest_missions"
  ON plateforme.everest_missions
  FOR INSERT TO authenticated
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY "admin_savr_update_everest_missions"
  ON plateforme.everest_missions
  FOR UPDATE TO authenticated
  USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- ops_savr : lecture + mise à jour (dashboard Ops + validation manuelle depuis route service_role)
-- Cohérent avec le pattern de la migration 0.4a (ops_savr SELECT + UPDATE sur tables admin).
CREATE POLICY "ops_savr_select_everest_missions"
  ON plateforme.everest_missions
  FOR SELECT TO authenticated
  USING (auth.jwt()->>'role' = 'ops_savr');

CREATE POLICY "ops_savr_update_everest_missions"
  ON plateforme.everest_missions
  FOR UPDATE TO authenticated
  USING (auth.jwt()->>'role' = 'ops_savr')
  WITH CHECK (auth.jwt()->>'role' = 'ops_savr');

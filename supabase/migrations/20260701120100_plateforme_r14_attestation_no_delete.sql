-- R14 · BL-P1-AUTH-02 — `attestations_don` : registre fiscal immuable (jamais DELETE)
-- =============================================================================
-- L'attestation de don (Cerfa 2041-GE) est une pièce fiscale : une fois générée,
-- elle ne doit jamais pouvoir être supprimée (obligation de conservation, §09 §8
-- « Factures / bordereaux / événements conservés » + §15). Or la policy
-- `att_admin ... AS PERMISSIVE FOR ALL TO public` (20260617180000) incluait le
-- DELETE → un admin_savr pouvait supprimer une attestation = trou registre
-- (audit conformité BL-P1-AUTH-02).
--
-- Correctif = scission de `att_admin` (FOR ALL) en SELECT / INSERT / UPDATE,
-- SANS policy DELETE. Modèle identique à `bordereaux_savr` (déjà scindé,
-- 20260619120000_m4_2_registre). La régénération auto (trigger R9 / batch) passe
-- par le service_role qui bypasse la RLS → non impactée. Aucune capacité retirée
-- aux autres rôles (les policies SELECT client/ops/traiteur/etc. restent intactes).
-- =============================================================================

DROP POLICY IF EXISTS att_admin ON plateforme.attestations_don;

CREATE POLICY att_admin_select ON plateforme.attestations_don
  FOR SELECT USING (plateforme.f_app_role() = 'admin_savr');

CREATE POLICY att_admin_insert ON plateforme.attestations_don
  FOR INSERT WITH CHECK (plateforme.f_app_role() = 'admin_savr');

CREATE POLICY att_admin_update ON plateforme.attestations_don
  FOR UPDATE USING (plateforme.f_app_role() = 'admin_savr')
  WITH CHECK (plateforme.f_app_role() = 'admin_savr');
-- Pas de policy DELETE : RLS DENY ALL résiduel → attestation jamais supprimable.

-- =============================================================================
-- MODULE 0.4c — RLS : Facturation, documents, emails, paramètres
-- Tables : factures, factures_collectes, bordereaux_savr, attestations_don,
--          rapports_rse, entites_facturation, sequences_facturation, jobs_pdf,
--          email_templates, emails_envoyes, integrations_inbox, integrations_logs,
--          exports_registre, documents_generaux_savr, audit_log,
--          parametres_algo, config_auto_accept_ag,
--          parametres_taux_recyclage + _history,
--          parametres_facteurs_co2 + _history,
--          parametres_mix_emballages + _history,
--          parametres_facteurs_co2_ag + _history,
--          parametres_co2_divers, coefficients_perte_labo,
--          tarifs_negocie, grilles_tarifaires_zd, tarifs_zero_dechet, tarifs_packs_ag
-- Vues : v_factures_client (SECURITY INVOKER)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLE factures — (§09 §3 tableau factures + note F5 masquage colonnes)
-- SELECT direct : staff seul. Clients → v_factures_client.
-- ---------------------------------------------------------------------------

CREATE POLICY fac_admin ON plateforme.factures
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- ops_savr : lecture + validation/envoi Pennylane (pas édition ligne/montant ni avoirs)
CREATE POLICY fac_ops_select ON plateforme.factures
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

CREATE POLICY fac_ops_update ON plateforme.factures
  FOR UPDATE USING (auth.jwt()->>'role' = 'ops_savr')
  WITH CHECK (auth.jwt()->>'role' = 'ops_savr');

-- Clients : SELECT direct interdit — passe par v_factures_client (SECURITY INVOKER, F5)
-- Aucune policy SELECT pour les rôles clients sur la table directe.

-- ---------------------------------------------------------------------------
-- 2. VUE v_factures_client — SECURITY INVOKER (§09 §3 note F5)
-- Colonnes marge_logistique et erreur_synchro* exclues.
-- Les prédicats org-scoped s'appliquent via les policies de la table factures.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS plateforme.v_factures_client;
CREATE VIEW plateforme.v_factures_client
  WITH (security_invoker = true)
AS
  SELECT
    id,
    organisation_id,
    entite_facturation_id,
    serie,
    annee,
    numero,
    numero_complet,
    statut,
    date_emission,
    montant_ht,
    taux_tva,
    montant_tva,
    montant_ttc,
    devise,
    pennylane_invoice_id,
    pennylane_push_at,
    pennylane_statut,
    avoir_de_facture_id,
    motif_avoir,
    pdf_fichier_id,
    notes,
    periode_debut,
    periode_fin,
    created_at,
    updated_at
    -- Colonnes exclues intentionnellement (masquage F5) :
    -- marge_logistique (si future), erreur_synchro* (si future)
  FROM plateforme.factures
  WHERE (
    auth.jwt()->>'role' IN ('traiteur_manager','traiteur_commercial','agence','gestionnaire_lieux')
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- ---------------------------------------------------------------------------
-- 3. TABLE factures_collectes — A4 (§09 §3ter A4)
-- ---------------------------------------------------------------------------

CREATE POLICY fc_admin ON plateforme.factures_collectes
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY fc_select ON plateforme.factures_collectes
  FOR SELECT USING (
    plateforme.f_is_staff()
    OR EXISTS (
      SELECT 1 FROM plateforme.factures f
      WHERE f.id = factures_collectes.facture_id
        AND f.organisation_id = (auth.jwt()->>'organisation_id')::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- 4. TABLE bordereaux_savr — (§09 §3 + B-3a 2026-06-11)
-- ---------------------------------------------------------------------------

CREATE POLICY bord_admin ON plateforme.bordereaux_savr
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY bord_ops_select ON plateforme.bordereaux_savr
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

-- Traiteur manager/commercial/agence : via FK collecte → événement → orga
CREATE POLICY bord_traiteur_select ON plateforme.bordereaux_savr
  FOR SELECT USING (
    auth.jwt()->>'role' IN ('traiteur_manager','traiteur_commercial','agence')
    AND EXISTS (
      SELECT 1 FROM plateforme.collectes c
      JOIN plateforme.evenements e ON e.id = c.evenement_id
      WHERE c.id = bordereaux_savr.collecte_id
        AND e.organisation_id = (auth.jwt()->>'organisation_id')::uuid
    )
  );

-- Gestionnaire lieux : via collecte → événement → lieu → organisations_lieux
CREATE POLICY bord_gestionnaire_select ON plateforme.bordereaux_savr
  FOR SELECT USING (
    auth.jwt()->>'role' = 'gestionnaire_lieux'
    AND EXISTS (
      SELECT 1 FROM plateforme.collectes c
      JOIN plateforme.evenements e ON e.id = c.evenement_id
      WHERE c.id = bordereaux_savr.collecte_id
        AND e.lieu_id IN (
          SELECT lieu_id FROM plateforme.organisations_lieux
          WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
        )
    )
  );

-- Client organisateur : B-3a (2026-06-11) — via collecte → événement → client_orga
CREATE POLICY bord_client_orga_select ON plateforme.bordereaux_savr
  FOR SELECT USING (
    auth.jwt()->>'role' = 'client_organisateur'
    AND EXISTS (
      SELECT 1 FROM plateforme.collectes c
      JOIN plateforme.evenements e ON e.id = c.evenement_id
      WHERE c.id = bordereaux_savr.collecte_id
        AND e.client_organisateur_organisation_id = (auth.jwt()->>'organisation_id')::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- 5. TABLE attestations_don — même logique que bordereaux_savr (+ B-3a)
-- ---------------------------------------------------------------------------

CREATE POLICY att_admin ON plateforme.attestations_don
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY att_ops_select ON plateforme.attestations_don
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

CREATE POLICY att_traiteur_select ON plateforme.attestations_don
  FOR SELECT USING (
    auth.jwt()->>'role' IN ('traiteur_manager','traiteur_commercial','agence')
    AND EXISTS (
      SELECT 1 FROM plateforme.collectes c
      JOIN plateforme.evenements e ON e.id = c.evenement_id
      WHERE c.id = attestations_don.collecte_id
        AND e.organisation_id = (auth.jwt()->>'organisation_id')::uuid
    )
  );

CREATE POLICY att_gestionnaire_select ON plateforme.attestations_don
  FOR SELECT USING (
    auth.jwt()->>'role' = 'gestionnaire_lieux'
    AND EXISTS (
      SELECT 1 FROM plateforme.collectes c
      JOIN plateforme.evenements e ON e.id = c.evenement_id
      WHERE c.id = attestations_don.collecte_id
        AND e.lieu_id IN (
          SELECT lieu_id FROM plateforme.organisations_lieux
          WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
        )
    )
  );

CREATE POLICY att_client_orga_select ON plateforme.attestations_don
  FOR SELECT USING (
    auth.jwt()->>'role' = 'client_organisateur'
    AND EXISTS (
      SELECT 1 FROM plateforme.collectes c
      JOIN plateforme.evenements e ON e.id = c.evenement_id
      WHERE c.id = attestations_don.collecte_id
        AND e.client_organisateur_organisation_id = (auth.jwt()->>'organisation_id')::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- 6. TABLE rapports_rse — A8 (§09 §3ter A8)
-- ---------------------------------------------------------------------------

CREATE POLICY rr_admin ON plateforme.rapports_rse
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY rr_select ON plateforme.rapports_rse
  FOR SELECT USING (
    plateforme.f_is_staff()
    OR rapports_rse.organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- Écriture : admin_savr (régénération) + SERVICE_ROLE (batch J+1)
CREATE POLICY rr_write_admin ON plateforme.rapports_rse
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- ---------------------------------------------------------------------------
-- 7. TABLE entites_facturation — Q2 corrigée (§09 §3quater Q2)
-- ---------------------------------------------------------------------------

CREATE POLICY ef_staff ON plateforme.entites_facturation
  FOR ALL USING (plateforme.f_is_staff())
  WITH CHECK (plateforme.f_is_staff());

-- Clients : lecture org-scoped uniquement (sélecteur formulaire, Mon organisation)
CREATE POLICY ef_select_own_org ON plateforme.entites_facturation
  FOR SELECT USING (
    organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- Écriture clients : FERMÉE V1 (onboarding SERVICE_ROLE, ajout via Admin §06.06)

-- ---------------------------------------------------------------------------
-- 8. TABLE sequences_facturation — Q3 (§09 §3quater Q3)
-- Écriture SERVICE_ROLE seul (numérotation gapless fiscale — même admin ne peut pas)
-- ---------------------------------------------------------------------------

CREATE POLICY sf_admin_read ON plateforme.sequences_facturation
  FOR SELECT USING (auth.jwt()->>'role' = 'admin_savr');

-- Aucune policy INSERT/UPDATE/DELETE : SERVICE_ROLE seul.

-- ---------------------------------------------------------------------------
-- 9. TABLE jobs_pdf — Q3 (§09 §3quater Q3)
-- ---------------------------------------------------------------------------

CREATE POLICY jp_admin_read ON plateforme.jobs_pdf
  FOR SELECT USING (auth.jwt()->>'role' = 'admin_savr');

-- Écriture SERVICE_ROLE seul (worker Railway + batchs J+1).

-- ---------------------------------------------------------------------------
-- 10. TABLE email_templates + emails_envoyes — A2bis (§09 §3ter A2bis)
-- emails_envoyes : PII — admin_savr SELECT seul
-- ---------------------------------------------------------------------------

CREATE POLICY etpl_admin_read ON plateforme.email_templates
  FOR SELECT USING (auth.jwt()->>'role' = 'admin_savr');

-- INSERT/UPDATE/DELETE : SERVICE_ROLE seul (édition V1 par migration)

CREATE POLICY eenv_admin_read ON plateforme.emails_envoyes
  FOR SELECT USING (auth.jwt()->>'role' = 'admin_savr');

-- ops_savr : DENY explicite (PII — §09 A2bis)
-- Pas de policy ops_savr → deny par défaut. Commentaire pour clarté :
-- SELECT emails_envoyes WHERE role='ops_savr' → 0 lignes (deny RLS)

-- ---------------------------------------------------------------------------
-- 11. TABLE integrations_inbox — A3 (§09 §3ter A3)
-- ---------------------------------------------------------------------------

CREATE POLICY inbox_admin_ops_read ON plateforme.integrations_inbox
  FOR SELECT USING (plateforme.f_is_staff());

-- INSERT/UPDATE/DELETE : SERVICE_ROLE uniquement.

-- ---------------------------------------------------------------------------
-- 12. TABLE integrations_logs — (§09 §3 « Admin Savr uniquement »)
-- ---------------------------------------------------------------------------

CREATE POLICY ilog_admin_read ON plateforme.integrations_logs
  FOR SELECT USING (plateforme.f_is_staff());

-- Écriture SERVICE_ROLE seul.

-- ---------------------------------------------------------------------------
-- 13. TABLE exports_registre + documents_generaux_savr — A10 (§09 §3ter A10)
-- ---------------------------------------------------------------------------

CREATE POLICY er_select ON plateforme.exports_registre
  FOR SELECT USING (
    plateforme.f_is_staff()
    OR created_by = auth.uid()
  );

CREATE POLICY er_insert ON plateforme.exports_registre
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

CREATE POLICY dg_read ON plateforme.documents_generaux_savr
  FOR SELECT USING (
    statut = 'genere'
    OR plateforme.f_is_staff()
  );

CREATE POLICY dg_write ON plateforme.documents_generaux_savr
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- ---------------------------------------------------------------------------
-- 14. TABLE audit_log — Q1 BLOQUANT (§09 §3quater Q1)
-- Append-only strict : UPDATE et DELETE bloqués pour TOUS, y compris admin_savr.
-- ---------------------------------------------------------------------------

CREATE POLICY al_select_staff ON plateforme.audit_log
  FOR SELECT USING (plateforme.f_is_staff());

-- INSERT : aucun rôle applicatif (triggers DB / SECURITY DEFINER / SERVICE_ROLE).
-- Pas de policy INSERT → deny pour tous les rôles authentifiés.

-- Défense en profondeur (au-delà du deny RLS) :
REVOKE UPDATE, DELETE ON plateforme.audit_log FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- 15. TABLE parametres_algo — A9 (§09 §3ter A9)
-- ---------------------------------------------------------------------------

CREATE POLICY pa_read ON plateforme.parametres_algo
  FOR SELECT USING (plateforme.f_is_staff());

CREATE POLICY pa_write ON plateforme.parametres_algo
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- ---------------------------------------------------------------------------
-- 16. TABLE config_auto_accept_ag — A9bis (§09 §3ter A9bis)
-- admin_savr seul (ops_savr DENY)
-- ---------------------------------------------------------------------------

CREATE POLICY caa_admin ON plateforme.config_auto_accept_ag
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- ---------------------------------------------------------------------------
-- 17. TABLES parametres_* — même patron (écriture admin, lecture ops, autres deny)
-- ---------------------------------------------------------------------------

-- parametres_taux_recyclage
CREATE POLICY ptr_admin ON plateforme.parametres_taux_recyclage
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY ptr_ops_read ON plateforme.parametres_taux_recyclage
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

-- parametres_taux_recyclage_history (append-only via trigger)
CREATE POLICY ptr_hist_staff_read ON plateforme.parametres_taux_recyclage_history
  FOR SELECT USING (plateforme.f_is_staff());

-- parametres_facteurs_co2
CREATE POLICY pfc_admin ON plateforme.parametres_facteurs_co2
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY pfc_ops_read ON plateforme.parametres_facteurs_co2
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

-- parametres_facteurs_co2_history
CREATE POLICY pfc_hist_staff_read ON plateforme.parametres_facteurs_co2_history
  FOR SELECT USING (plateforme.f_is_staff());

-- parametres_mix_emballages
CREATE POLICY pme_admin ON plateforme.parametres_mix_emballages
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY pme_ops_read ON plateforme.parametres_mix_emballages
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

-- parametres_mix_emballages_history
CREATE POLICY pme_hist_staff_read ON plateforme.parametres_mix_emballages_history
  FOR SELECT USING (plateforme.f_is_staff());

-- parametres_facteurs_co2_ag
CREATE POLICY pfca_admin ON plateforme.parametres_facteurs_co2_ag
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY pfca_ops_read ON plateforme.parametres_facteurs_co2_ag
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

-- parametres_facteurs_co2_ag_history
CREATE POLICY pfca_hist_staff_read ON plateforme.parametres_facteurs_co2_ag_history
  FOR SELECT USING (plateforme.f_is_staff());

-- parametres_co2_divers (auditée via audit_log, pas de _history dédiée)
CREATE POLICY pcd_admin ON plateforme.parametres_co2_divers
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY pcd_ops_read ON plateforme.parametres_co2_divers
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

-- ---------------------------------------------------------------------------
-- 18. TABLE coefficients_perte_labo — (§09 §3 table coefficients)
-- Lecture indirecte gestionnaire via f_dechets_labo_estimes (SECURITY DEFINER)
-- ---------------------------------------------------------------------------

CREATE POLICY cpl_admin ON plateforme.coefficients_perte_labo
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY cpl_ops_read ON plateforme.coefficients_perte_labo
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

-- ---------------------------------------------------------------------------
-- 19. TABLE tarifs_negocie — (§09 §3 tableau tarifs_negocie refonte 2026-05-26)
-- ---------------------------------------------------------------------------

CREATE POLICY tn_admin ON plateforme.tarifs_negocie
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- gestionnaire_lieux : lecture seule des remises qu'il a négociées
CREATE POLICY tn_gestionnaire_read ON plateforme.tarifs_negocie
  FOR SELECT USING (
    auth.jwt()->>'role' = 'gestionnaire_lieux'
    AND scope = 'gestionnaire'
    AND gestionnaire_organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- ---------------------------------------------------------------------------
-- 20. TABLES catalogue tarifaire — A5 (§09 §3ter A5)
-- Lecture authentifiée, écriture admin_savr seul
-- ---------------------------------------------------------------------------

CREATE POLICY gtz_read ON plateforme.grilles_tarifaires_zd
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY gtz_admin ON plateforme.grilles_tarifaires_zd
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY tzd_read ON plateforme.tarifs_zero_dechet
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY tzd_admin ON plateforme.tarifs_zero_dechet
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY tpa_read ON plateforme.tarifs_packs_ag
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY tpa_admin ON plateforme.tarifs_packs_ag
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- ---------------------------------------------------------------------------
-- 20bis. PARTITIONS — activer RLS sur les partitions existantes (V1 = 2026)
-- relrowsecurity ne se propage PAS du parent partitionné (relkind 'p') vers
-- ses partitions (relkind 'r'). Sans ce flag, un accès direct à la partition
-- (plateforme.audit_log_2026) contournerait RLS. Les policies du parent
-- (audit_log, integrations_logs) s'appliquent par héritage une fois le flag
-- posé → accès direct à la partition = DENY/policies parent (défense en profondeur).
-- Les futures partitions annuelles devront répliquer ce ENABLE.
-- ---------------------------------------------------------------------------

ALTER TABLE plateforme.audit_log_2026        ENABLE ROW LEVEL SECURITY;
ALTER TABLE plateforme.integrations_logs_2026 ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 21. ASSERTION GLOBALE — toutes tables plateforme.* + shared.* ont RLS enabled
--     ET au moins 1 policy (gate final module 0.4)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_no_rls integer;
  v_no_policy integer;
BEGIN
  -- Check 1 : relrowsecurity = true sur toutes les tables
  SELECT count(*) INTO v_no_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname IN ('plateforme','shared')
    AND c.relrowsecurity = false;

  IF v_no_rls > 0 THEN
    RAISE EXCEPTION 'ASSERTION 0.4c FAILED (RLS disabled): % table(s) without RLS', v_no_rls;
  END IF;

  -- Check 2 : chaque table NON-PARTITION a au moins 1 policy.
  -- Les partitions (relispartition = true) héritent les policies de leur parent
  -- partitionné : pas d'entrée pg_policy propre, mais protégées. On les exclut
  -- du check « no policy » (mais PAS du check 1 RLS ci-dessus : elles DOIVENT
  -- avoir relrowsecurity = true, garanti par le ENABLE 20bis).
  SELECT count(*) INTO v_no_policy
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND NOT c.relispartition
    AND n.nspname IN ('plateforme','shared')
    AND NOT EXISTS (
      SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
    );

  IF v_no_policy > 0 THEN
    RAISE EXCEPTION 'ASSERTION 0.4c FAILED (no policy): % table(s) have RLS enabled but no policy', v_no_policy;
  END IF;

  RAISE NOTICE 'ASSERTION 0.4c OK: RLS enabled + at least 1 policy on all plateforme.* and shared.* tables';
END $$;

-- ---------------------------------------------------------------------------
-- GRANTS vues clients (SECURITY INVOKER — RLS s'applique au rôle appelant)
-- ---------------------------------------------------------------------------
GRANT SELECT ON plateforme.v_factures_client TO authenticated;

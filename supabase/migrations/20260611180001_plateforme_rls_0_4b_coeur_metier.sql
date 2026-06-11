-- =============================================================================
-- MODULE 0.4b — RLS : Cœur métier
-- Tables : evenements, collectes, collecte_tournees, tournees, pesees_tournees,
--          collecte_flux, attributions_antgaspi, packs_antgaspi, outbox_events
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLE evenements — policies (§09 §3 tableau evenements)
-- ---------------------------------------------------------------------------

-- admin_savr : ALL
CREATE POLICY evt_admin ON plateforme.evenements
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- ops_savr : lecture ALL + écriture (forcer statut, etc.)
CREATE POLICY evt_ops_select ON plateforme.evenements
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

CREATE POLICY evt_ops_write ON plateforme.evenements
  FOR ALL USING (auth.jwt()->>'role' = 'ops_savr')
  WITH CHECK (auth.jwt()->>'role' = 'ops_savr');

-- traiteur_manager : org-wide SELECT (programmateur ou traiteur opérationnel)
CREATE POLICY evt_manager_select ON plateforme.evenements
  FOR SELECT USING (
    auth.jwt()->>'role' = 'traiteur_manager'
    AND (
      organisation_id                       = (auth.jwt()->>'organisation_id')::uuid
      OR traiteur_operationnel_organisation_id = (auth.jwt()->>'organisation_id')::uuid
    )
  );

CREATE POLICY evt_manager_insert ON plateforme.evenements
  FOR INSERT WITH CHECK (
    auth.jwt()->>'role' = 'traiteur_manager'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- UPDATE manager : ses propres programmations + fenêtre d'édition
CREATE POLICY evt_manager_update ON plateforme.evenements
  FOR UPDATE USING (
    auth.jwt()->>'role' = 'traiteur_manager'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
    AND plateforme.f_collecte_editable(id)
  )
  WITH CHECK (
    auth.jwt()->>'role' = 'traiteur_manager'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- DELETE manager : soft delete ses propres programmations
CREATE POLICY evt_manager_delete ON plateforme.evenements
  FOR DELETE USING (
    auth.jwt()->>'role' = 'traiteur_manager'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- traiteur_commercial : org-wide SELECT (révision 2026-05-29) + traiteur opérationnel
CREATE POLICY evt_commercial_select ON plateforme.evenements
  FOR SELECT USING (
    auth.jwt()->>'role' = 'traiteur_commercial'
    AND (
      organisation_id                         = (auth.jwt()->>'organisation_id')::uuid
      OR traiteur_operationnel_organisation_id = (auth.jwt()->>'organisation_id')::uuid
    )
  );

-- INSERT commercial : pas de restriction sur organisation (true) — événement rattaché ensuite
CREATE POLICY evt_commercial_insert ON plateforme.evenements
  FOR INSERT WITH CHECK (
    auth.jwt()->>'role' = 'traiteur_commercial'
  );

-- UPDATE commercial : ses propres créations + fenêtre d'édition (C2 sobriété)
CREATE POLICY evt_commercial_update ON plateforme.evenements
  FOR UPDATE USING (
    auth.jwt()->>'role' = 'traiteur_commercial'
    AND created_by = auth.uid()
    AND plateforme.f_collecte_editable(id)
  )
  WITH CHECK (
    auth.jwt()->>'role' = 'traiteur_commercial'
    AND created_by = auth.uid()
  );

-- agence : org-wide SELECT + INSERT libre + UPDATE fenêtre
CREATE POLICY evt_agence_select ON plateforme.evenements
  FOR SELECT USING (
    auth.jwt()->>'role' = 'agence'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

CREATE POLICY evt_agence_insert ON plateforme.evenements
  FOR INSERT WITH CHECK (
    auth.jwt()->>'role' = 'agence'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

CREATE POLICY evt_agence_update ON plateforme.evenements
  FOR UPDATE USING (
    auth.jwt()->>'role' = 'agence'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
    AND plateforme.f_collecte_editable(id)
  )
  WITH CHECK (
    auth.jwt()->>'role' = 'agence'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- gestionnaire_lieux : ses lieux (date non NULL = anti-fuite brouillons tiers, F3)
--                    + ses propres programmations
CREATE POLICY evt_gestionnaire_select ON plateforme.evenements
  FOR SELECT USING (
    auth.jwt()->>'role' = 'gestionnaire_lieux'
    AND (
      organisation_id = (auth.jwt()->>'organisation_id')::uuid
      OR (
        date_evenement IS NOT NULL
        AND lieu_id IN (
          SELECT lieu_id FROM plateforme.organisations_lieux
          WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
        )
      )
    )
  );

CREATE POLICY evt_gestionnaire_insert ON plateforme.evenements
  FOR INSERT WITH CHECK (
    auth.jwt()->>'role' = 'gestionnaire_lieux'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
    AND lieu_id IN (
      SELECT lieu_id FROM plateforme.organisations_lieux
      WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
    )
    AND traiteur_operationnel_organisation_id IN (
      SELECT id FROM plateforme.organisations
      WHERE type = 'traiteur' AND est_shadow = false
    )
  );

CREATE POLICY evt_gestionnaire_update ON plateforme.evenements
  FOR UPDATE USING (
    auth.jwt()->>'role' = 'gestionnaire_lieux'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
    AND plateforme.f_collecte_editable(id)
  )
  WITH CHECK (
    auth.jwt()->>'role' = 'gestionnaire_lieux'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- client_organisateur : lecture seule sur ses événements
CREATE POLICY evt_client_orga_select ON plateforme.evenements
  FOR SELECT USING (
    auth.jwt()->>'role' = 'client_organisateur'
    AND client_organisateur_organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- ---------------------------------------------------------------------------
-- 2. TABLE collectes — policies (§09 §3 B1 + restriction DELETE)
-- ---------------------------------------------------------------------------

-- admin_savr : ALL
CREATE POLICY col_admin ON plateforme.collectes
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- ops_savr : ALL (forcer statut, modifier pesées)
CREATE POLICY col_ops ON plateforme.collectes
  FOR ALL USING (auth.jwt()->>'role' = 'ops_savr')
  WITH CHECK (auth.jwt()->>'role' = 'ops_savr');

-- SELECT via f_collecte_visible (source unique — miroir exact de la fonction)
CREATE POLICY col_select ON plateforme.collectes
  FOR SELECT USING (plateforme.f_collecte_visible(id));

-- INSERT : l'événement parent appartient à l'orga du programmateur (B1 §09)
CREATE POLICY col_insert ON plateforme.collectes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM plateforme.evenements e
      WHERE e.id = evenement_id
        AND e.organisation_id = (auth.jwt()->>'organisation_id')::uuid
    )
  );

-- UPDATE commercial : collectes d'événements qu'il a créés + fenêtre édition (§05 §4)
CREATE POLICY col_update_commercial ON plateforme.collectes
  FOR UPDATE USING (
    auth.jwt()->>'role' = 'traiteur_commercial'
    AND EXISTS (
      SELECT 1 FROM plateforme.evenements e
      WHERE e.id = evenement_id AND e.created_by = auth.uid()
    )
    AND statut IN ('programmee','validee')
  )
  WITH CHECK (
    auth.jwt()->>'role' = 'traiteur_commercial'
    AND EXISTS (
      SELECT 1 FROM plateforme.evenements e
      WHERE e.id = evenement_id AND e.created_by = auth.uid()
    )
  );

-- UPDATE manager/agence/gestionnaire : org-scoped + fenêtre édition
CREATE POLICY col_update_client ON plateforme.collectes
  FOR UPDATE USING (
    auth.jwt()->>'role' IN ('traiteur_manager','agence','gestionnaire_lieux')
    AND EXISTS (
      SELECT 1 FROM plateforme.evenements e
      WHERE e.id = evenement_id
        AND e.organisation_id = (auth.jwt()->>'organisation_id')::uuid
    )
    AND statut IN ('programmee','validee')
  )
  WITH CHECK (
    auth.jwt()->>'role' IN ('traiteur_manager','agence','gestionnaire_lieux')
    AND EXISTS (
      SELECT 1 FROM plateforme.evenements e
      WHERE e.id = evenement_id
        AND e.organisation_id = (auth.jwt()->>'organisation_id')::uuid
    )
  );

-- DELETE : brouillon seulement (§09 §3 restriction DELETE 2026-06-07)
CREATE POLICY col_delete_brouillon ON plateforme.collectes
  FOR DELETE USING (
    statut = 'brouillon'
    AND (
      (
        auth.jwt()->>'role' IN ('traiteur_manager','agence','gestionnaire_lieux')
        AND EXISTS (
          SELECT 1 FROM plateforme.evenements e
          WHERE e.id = evenement_id
            AND e.organisation_id = (auth.jwt()->>'organisation_id')::uuid
        )
      )
      OR (
        auth.jwt()->>'role' = 'traiteur_commercial'
        AND EXISTS (
          SELECT 1 FROM plateforme.evenements e
          WHERE e.id = evenement_id AND e.created_by = auth.uid()
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 3. TABLE collecte_tournees — N↔N (§09 §3 tableau collecte_tournees)
-- Écriture : SERVICE_ROLE (adapter MTS-1) + admin_savr
-- ---------------------------------------------------------------------------

CREATE POLICY ct_admin ON plateforme.collecte_tournees
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY ct_ops_select ON plateforme.collecte_tournees
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

CREATE POLICY ct_select ON plateforme.collecte_tournees
  FOR SELECT USING (
    plateforme.f_collecte_visible(collecte_id)
  );

-- ---------------------------------------------------------------------------
-- 4. TABLE tournees — (§09 §3 B-5, SQL explicite)
-- ---------------------------------------------------------------------------

CREATE POLICY t_admin ON plateforme.tournees
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY t_ops_select ON plateforme.tournees
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

CREATE POLICY t_select ON plateforme.tournees
  FOR SELECT USING (
    plateforme.f_is_staff()
    OR EXISTS (
      SELECT 1 FROM plateforme.collecte_tournees ct
      WHERE ct.tournee_id = tournees.id
        AND plateforme.f_collecte_visible(ct.collecte_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 5. TABLE pesees_tournees — dérivée collecte_tournees → collecte_id (INC-0)
-- ---------------------------------------------------------------------------

CREATE POLICY pt_admin ON plateforme.pesees_tournees
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY pt_ops_select ON plateforme.pesees_tournees
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

CREATE POLICY pt_select ON plateforme.pesees_tournees
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM plateforme.collecte_tournees ct
      WHERE ct.tournee_id = pesees_tournees.tournee_id
        AND plateforme.f_collecte_visible(ct.collecte_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 6. TABLE collecte_flux — A6 (§09 §3ter A6/A7 F1 lot ⑪)
-- ---------------------------------------------------------------------------

CREATE POLICY cf_admin ON plateforme.collecte_flux
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY cf_select ON plateforme.collecte_flux
  FOR SELECT USING (plateforme.f_collecte_visible(collecte_id));

-- UPDATE staff : édition manuelle des pesées (ops_savr Oui — matrice étendue F1 lot ⑪)
CREATE POLICY cf_update_staff ON plateforme.collecte_flux
  FOR UPDATE USING (plateforme.f_is_staff())
  WITH CHECK (plateforme.f_is_staff());

-- INSERT : SERVICE_ROLE seul (5 flux créés automatiquement à la création collecte ZD)

-- ---------------------------------------------------------------------------
-- 7. TABLE attributions_antgaspi — A7 + C-1 (§09 §3ter A6/A7)
-- Prédicat restreint : exclut client_organisateur et gestionnaire_lieux (C-1)
-- ---------------------------------------------------------------------------

CREATE POLICY aa_admin ON plateforme.attributions_antgaspi
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- SELECT : staff + programmateur + traiteur opérationnel (C-1 : PAS f_collecte_visible)
CREATE POLICY aa_select ON plateforme.attributions_antgaspi
  FOR SELECT USING (
    plateforme.f_is_staff()
    OR EXISTS (
      SELECT 1 FROM plateforme.collectes c
      JOIN plateforme.evenements e ON e.id = c.evenement_id
      WHERE c.id = attributions_antgaspi.collecte_id
        AND (
          e.organisation_id                       = (auth.jwt()->>'organisation_id')::uuid
          OR e.traiteur_operationnel_organisation_id = (auth.jwt()->>'organisation_id')::uuid
        )
    )
  );

-- UPDATE ops : poids/volume (contrôle colonne-level applicatif)
CREATE POLICY aa_write_ops ON plateforme.attributions_antgaspi
  FOR UPDATE USING (auth.jwt()->>'role' = 'ops_savr')
  WITH CHECK (auth.jwt()->>'role' = 'ops_savr');

-- INSERT/DELETE : admin_savr (override AG) + SERVICE_ROLE (algo)

-- ---------------------------------------------------------------------------
-- 8. TABLE packs_antgaspi — B-1 tranché Val 2026-06-11 (§09 §3 tableau packs)
-- Écriture : admin_savr + ops_savr (matrice étendue fait foi)
-- ---------------------------------------------------------------------------

CREATE POLICY pa_staff ON plateforme.packs_antgaspi
  FOR ALL USING (plateforme.f_is_staff())
  WITH CHECK (plateforme.f_is_staff());

-- Lecture : manager + agence + gestionnaire (pack actif = condition de programmation AG)
CREATE POLICY pa_select_programmateurs ON plateforme.packs_antgaspi
  FOR SELECT USING (
    auth.jwt()->>'role' IN ('traiteur_manager','agence','gestionnaire_lieux')
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- ---------------------------------------------------------------------------
-- 9. TABLE outbox_events — A2 (§09 §3ter A2)
-- Deny total sauf admin_savr SELECT. Écriture SERVICE_ROLE uniquement.
-- ---------------------------------------------------------------------------

CREATE POLICY outbox_admin_read ON plateforme.outbox_events
  FOR SELECT USING (auth.jwt()->>'role' = 'admin_savr');

-- Aucune autre policy : deny total INSERT/UPDATE/DELETE pour tous les rôles applicatifs.
-- L'adapter et les triggers écrivent en SERVICE_ROLE (bypass RLS).

-- ---------------------------------------------------------------------------
-- 10. ASSERTION sous-lot 0.4b
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname = 'plateforme'
    AND c.relname IN (
      'evenements','collectes','collecte_tournees','tournees','pesees_tournees',
      'collecte_flux','attributions_antgaspi','packs_antgaspi','outbox_events'
    )
    AND c.relrowsecurity = false;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'ASSERTION 0.4b FAILED: % table(s) without RLS enabled', v_count;
  END IF;

  RAISE NOTICE 'ASSERTION 0.4b OK: all tables have RLS enabled';
END $$;

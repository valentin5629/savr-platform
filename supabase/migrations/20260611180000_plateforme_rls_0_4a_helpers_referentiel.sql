-- =============================================================================
-- MODULE 0.4a — RLS : Helpers + policies référentiel
-- Tables : organisations, users, lieux, organisations_lieux, associations,
--          transporteurs, flux_dechets, types_evenements, contacts_traiteurs,
--          shared.prestataires
-- Fonctions : f_is_staff, f_collecte_visible, f_collecte_editable,
--             f_dechets_labo_estimes, shared.f_fichier_visible
-- Vues     : v_referentiel_traiteurs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PREREQUIS : GRANT USAGE sur schémas custom (fonctions SECURITY DEFINER ont besoin
-- que le rôle puisse appeler les fonctions dans le schéma)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA plateforme TO authenticated, anon;
GRANT USAGE ON SCHEMA shared TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- PREREQUIS : privilèges table-level pour le rôle applicatif `authenticated`.
-- RLS filtre les LIGNES mais n'accorde pas l'accès à la table : sans ce GRANT,
-- toute requête lève « permission denied for table » AVANT l'évaluation RLS.
-- Pattern Supabase : GRANT large + RLS DENY ALL par défaut (les tables sans
-- policy applicable restent inaccessibles malgré le GRANT). `anon` ne reçoit
-- rien (aucune table publique en V1). Restrictions fines = REVOKE ciblés
-- (ex. audit_log append-only en 0.4c, exécuté après ce GRANT).
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plateforme TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shared TO authenticated;

-- ---------------------------------------------------------------------------
-- 0. HELPERS (à créer en premier — tout le reste en dépend)
-- ---------------------------------------------------------------------------

-- f_is_staff() — prédicat staff canonique (§09 §3 note F2 / lot ⑪)
CREATE OR REPLACE FUNCTION plateforme.f_is_staff()
RETURNS boolean LANGUAGE sql STABLE AS
$$
  SELECT auth.jwt()->>'role' IN ('admin_savr','ops_savr')
$$;

-- f_collecte_visible(uuid) — source unique de visibilité collecte (§09 §3ter, B-2)
CREATE OR REPLACE FUNCTION plateforme.f_collecte_visible(p_collecte_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
$$
  SELECT EXISTS (
    SELECT 1
    FROM plateforme.collectes c
    JOIN plateforme.evenements e ON e.id = c.evenement_id
    WHERE c.id = p_collecte_id
      AND (
        auth.jwt()->>'role' IN ('admin_savr','ops_savr')
        OR e.organisation_id                         = (auth.jwt()->>'organisation_id')::uuid
        OR e.traiteur_operationnel_organisation_id   = (auth.jwt()->>'organisation_id')::uuid
        OR e.client_organisateur_organisation_id     = (auth.jwt()->>'organisation_id')::uuid
        OR (
          e.date_evenement IS NOT NULL  -- garde anti-fuite brouillons tiers (B-2)
          AND e.lieu_id IN (
            SELECT lieu_id FROM plateforme.organisations_lieux
            WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
          )
        )
      )
  )
$$;

-- f_collecte_editable(uuid) — gate écriture niveau événement (§05 §4, sobriété C2)
-- Retourne TRUE si l'événement possède ≥1 collecte en brouillon/programmee/validee.
CREATE OR REPLACE FUNCTION plateforme.f_collecte_editable(p_evenement_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
$$
  SELECT EXISTS (
    SELECT 1 FROM plateforme.collectes
    WHERE evenement_id = p_evenement_id
      AND statut IN ('brouillon','programmee','validee')
  )
$$;

-- f_dechets_labo_estimes(uuid) — estimation poids déchets labo (§09 §3 table coefficients)
-- SECURITY DEFINER : lit coefficients_perte_labo avec droits propriétaire,
-- vérifie que l'événement appartient au périmètre du gestionnaire, ne retourne que kg.
-- Prend le coefficient de l'année de référence la plus récente pour ce traiteur.
CREATE OR REPLACE FUNCTION plateforme.f_dechets_labo_estimes(p_evenement_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS
$$
  SELECT COALESCE(
    (
      SELECT e.pax * c.coefficient_kg_couvert
      FROM plateforme.evenements e
      JOIN plateforme.coefficients_perte_labo c
        ON c.organisation_id = e.traiteur_operationnel_organisation_id
      WHERE e.id = p_evenement_id
        AND (
          plateforme.f_is_staff()
          OR e.lieu_id IN (
            SELECT lieu_id FROM plateforme.organisations_lieux
            WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
          )
          OR e.organisation_id = (auth.jwt()->>'organisation_id')::uuid
        )
      ORDER BY c.annee_reference DESC
      LIMIT 1
    ),
    0
  )
$$;

-- shared.f_fichier_visible(text, uuid) — visibilité polymorphe (§09 §3ter C1)
-- 9 entity_type V1 validés Val 2026-06-05. ELSE false = fail-safe.
CREATE OR REPLACE FUNCTION shared.f_fichier_visible(p_entity_type text, p_entity_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
$$
  SELECT CASE p_entity_type
    WHEN 'plateforme.collectes' THEN
      plateforme.f_collecte_visible(p_entity_id)

    WHEN 'plateforme.bordereaux_savr' THEN
      plateforme.f_collecte_visible(
        (SELECT collecte_id FROM plateforme.bordereaux_savr WHERE id = p_entity_id))

    WHEN 'plateforme.attestations_don' THEN
      plateforme.f_collecte_visible(
        (SELECT collecte_id FROM plateforme.attestations_don WHERE id = p_entity_id))

    WHEN 'plateforme.rapports_rse' THEN
      EXISTS (
        SELECT 1 FROM plateforme.rapports_rse r
        WHERE r.id = p_entity_id
          AND r.organisation_id = (auth.jwt()->>'organisation_id')::uuid
      )

    WHEN 'plateforme.organisations' THEN
      p_entity_id = (auth.jwt()->>'organisation_id')::uuid

    WHEN 'plateforme.lieux' THEN
      p_entity_id IN (
        SELECT lieu_id FROM plateforme.organisations_lieux
        WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
        UNION
        SELECT lieu_id FROM plateforme.evenements
        WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
      )

    WHEN 'plateforme.evenements' THEN
      EXISTS (
        SELECT 1 FROM plateforme.evenements e WHERE e.id = p_entity_id
          AND (
            e.organisation_id                         = (auth.jwt()->>'organisation_id')::uuid
            OR e.traiteur_operationnel_organisation_id = (auth.jwt()->>'organisation_id')::uuid
            OR e.client_organisateur_organisation_id   = (auth.jwt()->>'organisation_id')::uuid
            OR e.lieu_id IN (
              SELECT lieu_id FROM plateforme.organisations_lieux
              WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
            )
          )
      )

    WHEN 'plateforme.factures' THEN
      -- Scope strict : org-scoped + rôles clients uniquement (jamais client_organisateur)
      EXISTS (
        SELECT 1 FROM plateforme.factures f WHERE f.id = p_entity_id
          AND f.organisation_id = (auth.jwt()->>'organisation_id')::uuid
          AND auth.jwt()->>'role' IN (
            'traiteur_manager','traiteur_commercial','agence','gestionnaire_lieux'
          )
      )

    WHEN 'plateforme.documents_generaux_savr' THEN
      EXISTS (
        SELECT 1 FROM plateforme.documents_generaux_savr d
        WHERE d.id = p_entity_id AND d.statut = 'genere'
      )

    ELSE false  -- fail-safe : tout entity_type non listé = deny
  END
$$;

-- ---------------------------------------------------------------------------
-- 1. VUE whitelist traiteurs (§09 §3 note F5 — SECURITY DEFINER)
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS plateforme.v_referentiel_traiteurs;
CREATE VIEW plateforme.v_referentiel_traiteurs
  WITH (security_invoker = false)  -- SECURITY DEFINER
AS
  SELECT id, nom, raison_sociale
  FROM plateforme.organisations
  WHERE type = 'traiteur'
    AND est_shadow = false
    AND actif = true;

-- ---------------------------------------------------------------------------
-- 2. TABLE organisations — policies
-- ---------------------------------------------------------------------------

-- admin_savr : ALL
CREATE POLICY org_admin ON plateforme.organisations
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- ops_savr : lecture + écritures opérationnelles (pas tarif_refacture_pax_zd : contrôle applicatif)
CREATE POLICY org_ops_read ON plateforme.organisations
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

CREATE POLICY org_ops_write ON plateforme.organisations
  FOR UPDATE USING (auth.jwt()->>'role' = 'ops_savr')
  WITH CHECK (auth.jwt()->>'role' = 'ops_savr');

-- traiteur_manager : sa propre orga R+W
CREATE POLICY org_manager_select ON plateforme.organisations
  FOR SELECT USING (
    auth.jwt()->>'role' = 'traiteur_manager'
    AND id = (auth.jwt()->>'organisation_id')::uuid
  );

CREATE POLICY org_manager_update ON plateforme.organisations
  FOR UPDATE USING (
    auth.jwt()->>'role' = 'traiteur_manager'
    AND id = (auth.jwt()->>'organisation_id')::uuid
  )
  WITH CHECK (
    auth.jwt()->>'role' = 'traiteur_manager'
    AND id = (auth.jwt()->>'organisation_id')::uuid
  );

-- traiteur_commercial : sa propre orga R seul
CREATE POLICY org_commercial_select ON plateforme.organisations
  FOR SELECT USING (
    auth.jwt()->>'role' = 'traiteur_commercial'
    AND id = (auth.jwt()->>'organisation_id')::uuid
  );

-- agence : sa propre orga + fiches shadow créées par elle
CREATE POLICY org_agence_select ON plateforme.organisations
  FOR SELECT USING (
    auth.jwt()->>'role' = 'agence'
    AND (
      id = (auth.jwt()->>'organisation_id')::uuid
      OR (
        est_shadow = true
        AND cree_par_organisation_id = (auth.jwt()->>'organisation_id')::uuid
      )
    )
  );

CREATE POLICY org_agence_insert_shadow ON plateforme.organisations
  FOR INSERT WITH CHECK (
    auth.jwt()->>'role' = 'agence'
    AND est_shadow = true
    AND type = 'traiteur'
    AND cree_par_organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

CREATE POLICY org_agence_update ON plateforme.organisations
  FOR UPDATE USING (
    auth.jwt()->>'role' = 'agence'
    AND id = (auth.jwt()->>'organisation_id')::uuid
  )
  WITH CHECK (
    auth.jwt()->>'role' = 'agence'
    AND id = (auth.jwt()->>'organisation_id')::uuid
  );

-- gestionnaire_lieux : sa propre orga R+W
CREATE POLICY org_gestionnaire_select ON plateforme.organisations
  FOR SELECT USING (
    auth.jwt()->>'role' = 'gestionnaire_lieux'
    AND id = (auth.jwt()->>'organisation_id')::uuid
  );

CREATE POLICY org_gestionnaire_update ON plateforme.organisations
  FOR UPDATE USING (
    auth.jwt()->>'role' = 'gestionnaire_lieux'
    AND id = (auth.jwt()->>'organisation_id')::uuid
  )
  WITH CHECK (
    auth.jwt()->>'role' = 'gestionnaire_lieux'
    AND id = (auth.jwt()->>'organisation_id')::uuid
  );

-- client_organisateur : sa propre orga R seul (A-4, 2026-06-11)
CREATE POLICY org_client_orga_select ON plateforme.organisations
  FOR SELECT USING (
    auth.jwt()->>'role' = 'client_organisateur'
    AND id = (auth.jwt()->>'organisation_id')::uuid
  );

-- ---------------------------------------------------------------------------
-- 3. TABLE users — policies
-- ---------------------------------------------------------------------------

-- admin_savr : ALL (soft delete via deleted_at)
CREATE POLICY usr_admin ON plateforme.users
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- ops_savr : lecture ALL + écriture sauf promotion admin_savr + hard delete (contrôle applicatif)
CREATE POLICY usr_ops_select ON plateforme.users
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

CREATE POLICY usr_ops_write ON plateforme.users
  FOR UPDATE USING (auth.jwt()->>'role' = 'ops_savr')
  WITH CHECK (auth.jwt()->>'role' = 'ops_savr');

CREATE POLICY usr_ops_insert ON plateforme.users
  FOR INSERT WITH CHECK (auth.jwt()->>'role' = 'ops_savr');

-- traiteur_manager : org-wide R+W (invitation commerciaux + désactivation)
CREATE POLICY usr_manager_select ON plateforme.users
  FOR SELECT USING (
    auth.jwt()->>'role' = 'traiteur_manager'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

CREATE POLICY usr_manager_insert ON plateforme.users
  FOR INSERT WITH CHECK (
    auth.jwt()->>'role' = 'traiteur_manager'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

CREATE POLICY usr_manager_update ON plateforme.users
  FOR UPDATE USING (
    auth.jwt()->>'role' = 'traiteur_manager'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  )
  WITH CHECK (
    auth.jwt()->>'role' = 'traiteur_manager'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- gestionnaire_lieux : org-wide R+W (F5 lot ⑨ — invitation + désactivation collègues)
CREATE POLICY usr_gestionnaire_select ON plateforme.users
  FOR SELECT USING (
    auth.jwt()->>'role' = 'gestionnaire_lieux'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

CREATE POLICY usr_gestionnaire_insert ON plateforme.users
  FOR INSERT WITH CHECK (
    auth.jwt()->>'role' = 'gestionnaire_lieux'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

CREATE POLICY usr_gestionnaire_update ON plateforme.users
  FOR UPDATE USING (
    auth.jwt()->>'role' = 'gestionnaire_lieux'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  )
  WITH CHECK (
    auth.jwt()->>'role' = 'gestionnaire_lieux'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- traiteur_commercial : org-wide R (F4 lot ⑪) + UPDATE self only
CREATE POLICY usr_commercial_select ON plateforme.users
  FOR SELECT USING (
    auth.jwt()->>'role' = 'traiteur_commercial'
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

CREATE POLICY usr_commercial_update_self ON plateforme.users
  FOR UPDATE USING (
    auth.jwt()->>'role' = 'traiteur_commercial'
    AND id = auth.uid()
  )
  WITH CHECK (
    auth.jwt()->>'role' = 'traiteur_commercial'
    AND id = auth.uid()
  );

-- agence : self only R+W (F1 lot ⑨)
CREATE POLICY usr_agence_self ON plateforme.users
  FOR SELECT USING (
    auth.jwt()->>'role' = 'agence'
    AND id = auth.uid()
  );

CREATE POLICY usr_agence_update_self ON plateforme.users
  FOR UPDATE USING (
    auth.jwt()->>'role' = 'agence'
    AND id = auth.uid()
  )
  WITH CHECK (
    auth.jwt()->>'role' = 'agence'
    AND id = auth.uid()
  );

-- autres (client_organisateur, gestionnaire_lieux déjà couvert) : self only
CREATE POLICY usr_self_select ON plateforme.users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY usr_self_update ON plateforme.users
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. TABLE organisations_lieux — BLOQUANT A1 (§09 §3ter A1)
-- ---------------------------------------------------------------------------

CREATE POLICY org_lieux_admin ON plateforme.organisations_lieux
  FOR ALL USING (plateforme.f_is_staff())
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY org_lieux_self_select ON plateforme.organisations_lieux
  FOR SELECT USING (
    organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- ---------------------------------------------------------------------------
-- 5. TABLE lieux — policies (§09 §3 + Q4)
-- ---------------------------------------------------------------------------

CREATE POLICY lieux_admin ON plateforme.lieux
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY lieux_ops_read ON plateforme.lieux
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

CREATE POLICY lieux_ops_write ON plateforme.lieux
  FOR UPDATE USING (auth.jwt()->>'role' = 'ops_savr')
  WITH CHECK (auth.jwt()->>'role' = 'ops_savr');

CREATE POLICY lieux_clients_select ON plateforme.lieux
  FOR SELECT USING (
    auth.jwt()->>'role' NOT IN ('admin_savr','ops_savr')
    AND (
      id IN (
        SELECT lieu_id FROM plateforme.organisations_lieux
        WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
      )
      OR id IN (
        SELECT lieu_id FROM plateforme.evenements
        WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
      )
      OR id IN (  -- chemin client_organisateur (Q4 2026-06-11)
        SELECT lieu_id FROM plateforme.evenements
        WHERE client_organisateur_organisation_id = (auth.jwt()->>'organisation_id')::uuid
          AND date_evenement IS NOT NULL
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 6. TABLE associations — référentiel (§09 §3 tableau référentiel)
-- ---------------------------------------------------------------------------

CREATE POLICY asso_admin ON plateforme.associations
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- ops_savr : lecture + écriture opérationnelle sauf SIREN/habilitation/désactivation (contrôle appli)
CREATE POLICY asso_ops_select ON plateforme.associations
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

CREATE POLICY asso_ops_update ON plateforme.associations
  FOR UPDATE USING (auth.jwt()->>'role' = 'ops_savr')
  WITH CHECK (auth.jwt()->>'role' = 'ops_savr');

-- tous rôles authentifiés : lecture référentiel
CREATE POLICY asso_read ON plateforme.associations
  FOR SELECT USING (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 7. TABLE transporteurs — référentiel (§09 §3 + addendum F3 2026-06-07)
-- ---------------------------------------------------------------------------

CREATE POLICY transp_admin ON plateforme.transporteurs
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- ops_savr : lecture + écriture (incl. SIREN + désactivation — F3 tranché Val)
CREATE POLICY transp_ops_select ON plateforme.transporteurs
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

CREATE POLICY transp_ops_write ON plateforme.transporteurs
  FOR UPDATE USING (auth.jwt()->>'role' = 'ops_savr')
  WITH CHECK (auth.jwt()->>'role' = 'ops_savr');

-- tous rôles authentifiés : lecture référentiel
CREATE POLICY transp_read ON plateforme.transporteurs
  FOR SELECT USING (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 8. TABLES référentiel lecture-seule (flux_dechets, types_evenements)
-- ---------------------------------------------------------------------------

CREATE POLICY fd_admin ON plateforme.flux_dechets
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY fd_read ON plateforme.flux_dechets
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY te_admin ON plateforme.types_evenements
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY te_read ON plateforme.types_evenements
  FOR SELECT USING (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 9. TABLE contacts_traiteurs (§09 §3 tableau référentiel)
-- ---------------------------------------------------------------------------

CREATE POLICY ct_admin ON plateforme.contacts_traiteurs
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

CREATE POLICY ct_ops_select ON plateforme.contacts_traiteurs
  FOR SELECT USING (auth.jwt()->>'role' = 'ops_savr');

-- traiteur_manager + traiteur_commercial : org-scoped R+W
CREATE POLICY ct_traiteur_select ON plateforme.contacts_traiteurs
  FOR SELECT USING (
    auth.jwt()->>'role' IN ('traiteur_manager','traiteur_commercial')
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

CREATE POLICY ct_traiteur_write ON plateforme.contacts_traiteurs
  FOR ALL USING (
    auth.jwt()->>'role' IN ('traiteur_manager','traiteur_commercial')
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  )
  WITH CHECK (
    auth.jwt()->>'role' IN ('traiteur_manager','traiteur_commercial')
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- autres rôles authentifiés : lecture référentiel
CREATE POLICY ct_read ON plateforme.contacts_traiteurs
  FOR SELECT USING (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 10. TABLE shared.prestataires — cross-schema (§09 addendum 2026-04-23)
-- Lecture admin/ops seul depuis app_domain='plateforme'. Écriture refusée.
-- ---------------------------------------------------------------------------

CREATE POLICY prest_plateforme_read ON shared.prestataires
  FOR SELECT USING (
    auth.jwt()->>'role' IN ('admin_savr','ops_savr')
  );

-- INSERT/UPDATE/DELETE depuis plateforme : aucune policy → DENY (écriture via TMS M06)

-- ---------------------------------------------------------------------------
-- 11. TABLE shared.fichiers — BLOQUANT C1 (§09 §3ter C1)
-- ---------------------------------------------------------------------------

CREATE POLICY fichiers_select ON shared.fichiers
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      plateforme.f_is_staff()
      OR shared.f_fichier_visible(entity_type, entity_id)
    )
  );

-- INSERT/UPDATE/DELETE : SERVICE_ROLE (generate-pdf, uploads) + admin_savr
CREATE POLICY fichiers_admin_write ON shared.fichiers
  FOR ALL USING (auth.jwt()->>'role' = 'admin_savr')
  WITH CHECK (auth.jwt()->>'role' = 'admin_savr');

-- ---------------------------------------------------------------------------
-- 12. ASSERTION : toutes les tables de ce sous-lot ont relrowsecurity = true
--     et au moins 1 policy. Exécutée ici pour validation manuelle/CI.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname IN ('plateforme','shared')
    AND c.relname IN (
      'organisations','users','organisations_lieux','lieux',
      'associations','transporteurs','flux_dechets','types_evenements',
      'contacts_traiteurs','prestataires','fichiers'
    )
    AND c.relrowsecurity = false;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'ASSERTION 0.4a FAILED: % table(s) without RLS enabled', v_count;
  END IF;

  RAISE NOTICE 'ASSERTION 0.4a OK: all tables have RLS enabled';
END $$;

-- ---------------------------------------------------------------------------
-- GRANTS fonctions helpers (SECURITY DEFINER — appelées dans les policies RLS)
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION plateforme.f_is_staff() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION plateforme.f_collecte_visible(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION plateforme.f_collecte_editable(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION plateforme.f_dechets_labo_estimes(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION shared.f_fichier_visible(text, uuid) TO authenticated, anon;

-- Vue référentiel traiteurs (SECURITY DEFINER via security_invoker=false — bypass RLS)
GRANT SELECT ON plateforme.v_referentiel_traiteurs TO authenticated;

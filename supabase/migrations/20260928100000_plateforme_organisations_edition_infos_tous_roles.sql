-- =============================================================================
-- organisations : informations légales modifiables par tous les rôles clients
-- =============================================================================
-- Décision Val 2026-09-28 (revue E2E, écran /agence/mon-organisation) : « tous les
-- utilisateurs doivent pouvoir modifier leurs informations, pour tous les rôles ».
-- Le CDC réservait l'édition des informations légales au traiteur_manager (§06.04 §6)
-- et limitait le gestionnaire à adresse + logo (§06.05 §6). Écart tracé :
-- _Divergences/M3.1_20260928_edition-infos-organisation-tous-roles.md (type ambigu).
--
-- État avant cette migration (mesuré sur savr-dev, pg_policies) :
--   - policy UPDATE own-org : admin, ops, traiteur_manager, agence, gestionnaire_lieux ;
--   - AUCUNE policy UPDATE pour traiteur_commercial ni client_organisateur ;
--   - trigger trg_block_org_gestionnaire_cols_update : gestionnaire limité à
--     adresse + logo_url.
--
-- Ce que fait la migration :
--   1. deux policies UPDATE own-org (traiteur_commercial, client_organisateur), même
--      prédicat que org_manager_update / org_agence_update : sa propre ligne, jamais
--      une autre (ni une fiche shadow, ni un traiteur tiers) ;
--   2. la garde colonne du trigger existant devient une liste blanche PAR RÔLE :
--        gestionnaire_lieux                        → raison_sociale, siret, adresse, logo_url
--        traiteur_commercial, client_organisateur  → raison_sociale, siret, adresse
--      Les nouvelles policies n'ouvrent donc QUE les trois champs légaux : nom, email,
--      téléphone, updated_at restent refusés (42501) à ces rôles, y compris par
--      PostgREST direct. Rôles non listés (manager, agence, staff) : inchangés.
--
-- OUVRE un accès (CLAUDE.md §12-2bis) : application prod = Val, après GO
-- reviewer-rls-securite. Aucune donnée touchée, aucune colonne retirée ni renommée.
-- =============================================================================

-- ─── 1. Policies UPDATE own-org ──────────────────────────────────────────────
CREATE POLICY org_commercial_update ON plateforme.organisations
  FOR UPDATE TO authenticated
  USING (
    plateforme.f_app_role() = 'traiteur_commercial'
    AND id = (auth.jwt()->>'organisation_id')::uuid
  )
  WITH CHECK (
    plateforme.f_app_role() = 'traiteur_commercial'
    AND id = (auth.jwt()->>'organisation_id')::uuid
  );

CREATE POLICY org_client_orga_update ON plateforme.organisations
  FOR UPDATE TO authenticated
  USING (
    plateforme.f_app_role() = 'client_organisateur'
    AND id = (auth.jwt()->>'organisation_id')::uuid
  )
  WITH CHECK (
    plateforme.f_app_role() = 'client_organisateur'
    AND id = (auth.jwt()->>'organisation_id')::uuid
  );

-- ─── 2. Garde colonne : liste blanche par rôle ───────────────────────────────
-- Nom de fonction/trigger conservé (historique 20260918100000) ; SET search_path
-- répété : CREATE OR REPLACE remplace proconfig.
CREATE OR REPLACE FUNCTION plateforme.fn_block_org_gestionnaire_cols_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_role text := plateforme.f_app_role();
  v_libres text[];
BEGIN
  IF v_role = 'gestionnaire_lieux' THEN
    v_libres := ARRAY['raison_sociale', 'siret', 'adresse', 'logo_url'];
  ELSIF v_role IN ('traiteur_commercial', 'client_organisateur') THEN
    v_libres := ARRAY['raison_sociale', 'siret', 'adresse'];
  ELSE
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_libres) IS DISTINCT FROM (to_jsonb(OLD) - v_libres) THEN
    RAISE EXCEPTION '% : seules les informations légales de l''organisation (%) sont modifiables',
      v_role, array_to_string(v_libres, ', ')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION plateforme.fn_block_org_gestionnaire_cols_update() FROM PUBLIC, anon, authenticated;

COMMENT ON TRIGGER trg_block_org_gestionnaire_cols_update ON plateforme.organisations IS
  'Liste blanche UPDATE par rôle métier sur SA propre organisation (décision Val 2026-09-28) : gestionnaire_lieux = raison_sociale, siret, adresse, logo_url ; traiteur_commercial et client_organisateur = raison_sociale, siret, adresse. Le GRANT UPDATE colonne-level est commun à tous les rôles PG authenticated : il ne peut pas porter cette restriction par rôle métier. Manager, agence et staff : non concernés.';

-- ROLLBACK (referme l'accès) : retirer les policies org_commercial_update et
-- org_client_orga_update, puis restaurer le corps de la fonction de 20260918100000
-- (gestionnaire_lieux seul, liste adresse + logo_url).

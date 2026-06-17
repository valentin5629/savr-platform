-- M3.4 — Espace client organisateur (dashboard RSE lecture seule + documents).
-- Module front + lecture seule : aucune nouvelle table, aucune nouvelle règle métier.
-- Cette migration comble le seul gap DB nécessaire à l'espace organisateur :
--
--   1. f_volume_repas_realise(uuid) — helper SECURITY DEFINER exposant UNIQUEMENT
--      le volume de repas détournés (impact AG du client organisateur), sans lever
--      le voile C-1 sur attributions_antgaspi (association recommandée / scoring /
--      branche restent invisibles). Requis car v_kpi_client_organisateur est
--      security_invoker=true : sous le JWT organisateur la LEFT JOIN attributions
--      est RLS-filtrée → nb_repas_donnes valait 0 (défaut latent non couvert par M3.5,
--      T6 ne testait la vue que sous superuser). §11 §7 onglet AG exige « repas détournés ».
--
--   2. v_kpi_client_organisateur — recréée : repas via le helper (plus de JOIN
--      attributions) + ajout co2_induit_kg / energie_primaire_evitee_kwh pour le
--      détail repliable « règle ABC » de l'onglet ZD (§11 §7, lus depuis collectes.co2_* figés).
--      Additif et organisateur-only (seule la route kpi-client-organisateur la consomme).
--
--   3. rr_select (rapports_rse) + branche rapports_rse de f_fichier_visible — élargies
--      à f_collecte_visible(collecte_id). Closes la dette 0.4c documentée : la policy
--      ne matchait que evenements.organisation_id (donneur d'ordre) → le client
--      organisateur (client_organisateur_organisation_id) ne pouvait pas lire ses
--      rapports RSE. f_collecte_visible porte déjà les 3-4 branches voulues
--      (staff / donneur d'ordre / traiteur opérationnel / client organisateur / gestionnaire via lieu).
--      Cohérent avec les branches bordereaux_savr / attestations_don déjà en place.

-- ---------------------------------------------------------------------------
-- 1. Helper f_volume_repas_realise — impact AG sans fuite C-1
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plateforme.f_volume_repas_realise(p_collecte_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = plateforme, public
AS $$
  SELECT CASE
    WHEN plateforme.f_collecte_visible(p_collecte_id) THEN
      COALESCE((
        SELECT SUM(aa.volume_repas_realise)
        FROM plateforme.attributions_antgaspi aa
        WHERE aa.collecte_id = p_collecte_id
      ), 0)
    ELSE 0
  END
$$;

REVOKE ALL ON FUNCTION plateforme.f_volume_repas_realise(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_volume_repas_realise(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Vue v_kpi_client_organisateur — recréée (repas C-1-safe + CO2 ABC)
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS plateforme.v_kpi_client_organisateur;

CREATE VIEW plateforme.v_kpi_client_organisateur
  WITH (security_invoker = true)
AS
WITH tpc AS (
  SELECT collecte_id, SUM(COALESCE(poids_reel_kg, 0)) AS tonnage_kg
  FROM plateforme.collecte_flux
  GROUP BY collecte_id
),
base AS (
  SELECT
    e.client_organisateur_organisation_id       AS organisation_id,
    date_trunc('month', c.date_collecte)::date  AS mois,
    c.id                                         AS collecte_id,
    c.type                                       AS type_collecte,
    e.id                                         AS evenement_id,
    COALESCE(tpc.tonnage_kg, 0)                  AS tonnage_kg,
    c.taux_recyclage,
    c.co2_induit_kg,
    c.co2_evite_kg,
    c.co2_net_kg,
    c.energie_primaire_evitee_kwh,
    plateforme.f_volume_repas_realise(c.id)      AS volume_repas_realise
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  LEFT JOIN tpc ON tpc.collecte_id = c.id
  WHERE c.statut = 'cloturee'
    AND e.client_organisateur_organisation_id IS NOT NULL
)
SELECT
  b.organisation_id,
  b.mois,
  b.type_collecte,
  COUNT(DISTINCT b.collecte_id) AS nb_collectes,
  COUNT(DISTINCT b.evenement_id) AS nb_evenements,
  -- ZD
  SUM(CASE WHEN b.type_collecte = 'zero_dechet' THEN b.tonnage_kg END) AS tonnage_kg,
  CASE WHEN SUM(CASE WHEN b.type_collecte = 'zero_dechet' AND b.taux_recyclage IS NOT NULL
                      THEN b.tonnage_kg END) > 0
       THEN SUM(CASE WHEN b.type_collecte = 'zero_dechet' AND b.taux_recyclage IS NOT NULL
                      THEN b.taux_recyclage * b.tonnage_kg END) /
            SUM(CASE WHEN b.type_collecte = 'zero_dechet' AND b.taux_recyclage IS NOT NULL
                      THEN b.tonnage_kg END)
       ELSE NULL
  END AS taux_recyclage_pondere,
  -- AG
  SUM(CASE WHEN b.type_collecte = 'anti_gaspi' THEN b.volume_repas_realise END) AS nb_repas_donnes,
  -- CO2 (toutes collectes) — règle ABC : induit (A) + évité (B) + net + énergie primaire
  SUM(b.co2_induit_kg)              AS co2_induit_kg,
  SUM(b.co2_evite_kg)               AS co2_evite_kg,
  SUM(b.co2_net_kg)                 AS co2_net_kg,
  SUM(b.energie_primaire_evitee_kwh) AS energie_primaire_evitee_kwh
FROM base b
GROUP BY b.organisation_id, b.mois, b.type_collecte;

GRANT SELECT ON plateforme.v_kpi_client_organisateur TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. rapports_rse — rr_select élargi (dette 0.4c : chemin client_organisateur)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS rr_select ON plateforme.rapports_rse;
CREATE POLICY rr_select ON plateforme.rapports_rse
  FOR SELECT USING (
    plateforme.f_is_staff()
    OR plateforme.f_collecte_visible(collecte_id)
  );

-- ---------------------------------------------------------------------------
-- 4. f_fichier_visible — branche rapports_rse alignée sur f_collecte_visible
--    (cohérence avec bordereaux_savr / attestations_don ; closes dette 0.4c).
--    CREATE OR REPLACE conserve les GRANT existants.
-- ---------------------------------------------------------------------------

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
      plateforme.f_collecte_visible(
        (SELECT collecte_id FROM plateforme.rapports_rse WHERE id = p_entity_id))

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

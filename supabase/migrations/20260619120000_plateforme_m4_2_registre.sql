-- ============================================================
-- M4.2 — Registre réglementaire ZD
-- ============================================================
-- 1. Alignement `exports_registre` sur le DDL cible V2 (§04 + schema_cible_v2) :
--    la table créée au bloc6 (20260611171640) divergeait de la cible
--    (created_by/nb_collectes/created_at + colonnes type_export/format/
--    filtres_appliques manquantes). Garde-fou TMS-Ready #1 : le modèle V1 doit
--    être ⊆ cible — jamais une structure renommée au cutover. La table n'a
--    aucun consommateur en V1 (M4.2 = 1er usage), le rename est donc sans
--    risque. Divergence documentée : _Divergences/M4.2_20260619.md (clair).
-- 2. Reconstruction de la vue `v_registre_dechets` au grain COLLECTE (poids
--    total agrégé multi-pesées, flux en tableau) + colonnes bordereau/exutoire/
--    traiteur opérationnel/historique_partiel attendues par §06.03, et surtout
--    cloisonnement interne via f_collecte_visible (la vue précédente était
--    SECURITY DEFINER SANS prédicat d'organisation → fuite cross-org).
-- ============================================================

-- ------------------------------------------------------------
-- 1a. Enums exports (alignement DDL cible V2 §04)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'type_export' AND n.nspname = 'plateforme'
  ) THEN
    CREATE TYPE plateforme.type_export AS ENUM
      ('registre_dechets', 'bordereaux_batch', 'attestations_batch');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'export_format' AND n.nspname = 'plateforme'
  ) THEN
    CREATE TYPE plateforme.export_format AS ENUM ('csv', 'zip', 'pdf');
  END IF;
END $$;

-- ------------------------------------------------------------
-- 1b. Alignement colonnes exports_registre sur la cible
--     (rename non destructif : ni DROP COLUMN ni TRUNCATE)
-- ------------------------------------------------------------
ALTER TABLE plateforme.exports_registre RENAME COLUMN created_by   TO user_id;
ALTER TABLE plateforme.exports_registre RENAME COLUMN nb_collectes TO nb_lignes;
ALTER TABLE plateforme.exports_registre RENAME COLUMN created_at   TO genere_at;

ALTER TABLE plateforme.exports_registre
  ADD COLUMN IF NOT EXISTS type_export       plateforme.type_export   NOT NULL DEFAULT 'registre_dechets',
  ADD COLUMN IF NOT EXISTS format            plateforme.export_format NOT NULL DEFAULT 'csv',
  ADD COLUMN IF NOT EXISTS filtres_appliques jsonb;

-- Recréation des policies A10 (§09) sur le nouveau nom de colonne `user_id`.
-- (Le rename propage déjà la référence, on réécrit pour rester verbatim §09.)
DROP POLICY IF EXISTS er_select ON plateforme.exports_registre;
DROP POLICY IF EXISTS er_insert ON plateforme.exports_registre;

CREATE POLICY er_select ON plateforme.exports_registre
  FOR SELECT USING (
    plateforme.f_is_staff()
    OR user_id = auth.uid()
  );

CREATE POLICY er_insert ON plateforme.exports_registre
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- ------------------------------------------------------------
-- 1c. bordereaux_savr : registre auditable → AUCUN DELETE (§09 matrice :
--     DELETE = — pour tous, admin inclus). La policy `bord_admin FOR ALL`
--     (20260611180002) sur-octroyait le DELETE à admin_savr, en écart avec la
--     matrice §09 et le scénario delete_bordereau_emis_deny_tous_roles (P1).
--     On la scinde en SELECT/INSERT/UPDATE (pas de DELETE). Divergence clair.
-- ------------------------------------------------------------
-- Rôle métier lu via f_app_role() (claim `user_role`, convention post-fix
-- 20260617180000) — JAMAIS auth.jwt()->>'role' (réservé PostgREST SET ROLE).
DROP POLICY IF EXISTS bord_admin ON plateforme.bordereaux_savr;

CREATE POLICY bord_admin_select ON plateforme.bordereaux_savr
  FOR SELECT USING (plateforme.f_app_role() = 'admin_savr');

CREATE POLICY bord_admin_insert ON plateforme.bordereaux_savr
  FOR INSERT WITH CHECK (plateforme.f_app_role() = 'admin_savr');

CREATE POLICY bord_admin_update ON plateforme.bordereaux_savr
  FOR UPDATE USING (plateforme.f_app_role() = 'admin_savr')
  WITH CHECK (plateforme.f_app_role() = 'admin_savr');
-- Pas de policy DELETE : RLS DENY ALL résiduel → bordereau jamais supprimable
-- par un rôle applicatif (registre réglementaire R541-43, auditable).

-- ------------------------------------------------------------
-- 2. Vue v_registre_dechets — grain collecte + cloisonnement interne
-- ------------------------------------------------------------
-- Passage flux-grain → collecte-grain : on ne peut pas CREATE OR REPLACE (jeu
-- de colonnes différent), donc DROP + CREATE (la vue n'a aucun objet dépendant ;
-- seuls 2 tests pgTAP la lisent en count(*) sous rôle agence → 0, inchangé).
DROP VIEW IF EXISTS plateforme.v_registre_dechets;

CREATE VIEW plateforme.v_registre_dechets WITH (security_invoker = false) AS
SELECT
  c.id                                            AS collecte_id,
  c.evenement_id,
  e.date_evenement,
  c.date_collecte,
  e.nom_evenement                                 AS evenement_nom,
  e.pax,
  plateforme.taille_evenement_bracket(e.pax)      AS taille_bracket,
  e.type_evenement_id,
  e.lieu_id,
  l.nom                                           AS lieu_nom,
  l.adresse_acces                                 AS lieu_adresse,
  e.organisation_id                               AS programmateur_organisation_id,
  e.traiteur_operationnel_organisation_id,
  -- Traiteur opérationnel = producteur juridique du déchet (F4), fiches shadow
  -- incluses (raison sociale sans SIRET) ; fallback nom si raison_sociale NULL.
  COALESCE(top.raison_sociale, top.nom)           AS traiteur_raison_sociale,
  c.prestataire_logistique_id,
  sp.nom                                          AS transporteur_nom,
  b.exutoire_nom,
  COALESCE(agg.poids_total_kg, 0)::numeric(12, 3) AS poids_total_kg,
  COALESCE(agg.flux_codes, ARRAY[]::text[])       AS flux_codes,
  c.taux_recyclage,
  c.co2_induit_kg,
  c.co2_evite_kg,
  c.co2_net_kg,
  b.id                                            AS bordereau_id,
  b.numero                                        AS bordereau_numero,
  b.statut                                        AS bordereau_statut,
  b.pdf_fichier_id                                AS bordereau_pdf_fichier_id,
  b.date_emission                                 AS bordereau_date_emission,
  b.version                                       AS bordereau_version,
  c.historique_partiel,
  c.realisee_at,
  c.created_at
FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  JOIN plateforme.lieux l ON l.id = e.lieu_id
  LEFT JOIN plateforme.organisations top
    ON top.id = e.traiteur_operationnel_organisation_id
  LEFT JOIN shared.prestataires sp ON sp.id = c.prestataire_logistique_id
  LEFT JOIN plateforme.bordereaux_savr b ON b.collecte_id = c.id
  LEFT JOIN LATERAL (
    -- Poids total = SUM de TOUTES les pesées de la collecte (multi-pesées
    -- d'un même flux agrégées) ; flux_codes = badges distincts triés.
    SELECT
      SUM(cf.poids_reel_kg)                                AS poids_total_kg,
      array_agg(DISTINCT fd.code ORDER BY fd.code)         AS flux_codes
    FROM plateforme.collecte_flux cf
      JOIN plateforme.flux_dechets fd ON fd.id = cf.flux_id
    WHERE cf.collecte_id = c.id
  ) agg ON true
WHERE c.statut = 'cloturee'::plateforme.collecte_statut_enum
  AND c.type   = 'zero_dechet'::plateforme.collecte_type_enum
  -- Exclusion agence (F6 2026-06-07) : donneuse d'ordre, non productrice → 0 ligne.
  AND plateforme.f_app_role() IS DISTINCT FROM 'agence'
  -- Cloisonnement par organisation (miroir policy collectes) : staff full,
  -- programmateur, traiteur opérationnel, client organisateur, gestionnaire
  -- de lieux via organisations_lieux. Source unique : f_collecte_visible.
  AND plateforme.f_collecte_visible(c.id);

GRANT SELECT ON plateforme.v_registre_dechets TO authenticated;

COMMENT ON VIEW plateforme.v_registre_dechets IS
  'Registre réglementaire ZD (M4.2, §06.03). Grain collecte : poids_total_kg '
  'agrégé multi-pesées, flux_codes[] pour les badges. SECURITY DEFINER + '
  'cloisonnement interne f_collecte_visible (la vue joint shared.prestataires '
  'admin-only → security_invoker impossible). Exclusion agence (F6). Périmètre '
  'V1 : collectes cloturee + zero_dechet uniquement (volet AG = V2).';

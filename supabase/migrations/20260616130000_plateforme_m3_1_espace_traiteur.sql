-- M3.1 — Espace client traiteur
-- 1) Dette RLS colonne : organisations.tarif_refacture_pax_zd modifiable Admin Savr only
-- 2) Benchmark grain single_collecte (fiche collecte Bloc 3 ZD) — fail-fast RLS
--
-- Source : §06.04 (Impact data model tarif_refacture_pax_zd, fiche collecte Bloc 3 ZD)
--          §09 (tarif_refacture lecture traiteur / écriture admin-only)
--          test scenarios §06.04 (tarif_refacture_lecture_traiteur_ecriture_admin_only,
--          benchmark_single_collecte_rls_fail_fast)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Restriction colonne : tarif_refacture_pax_zd écriture Admin Savr only
-- ─────────────────────────────────────────────────────────────────────────────
-- La policy org_manager_update (0.4a) autorise le manager à UPDATE TOUTE colonne
-- de sa propre organisation. La RLS filtre les LIGNES, jamais les colonnes :
-- sans restriction au niveau privilège, un manager pourrait modifier
-- tarif_refacture_pax_zd (paramètre financier réservé Admin Savr, §06.04 +
-- §06.06 Back-office). Même pattern que le masquage F5 factures (M3.5) :
-- on retire le UPDATE table-level du blanket grant 0.4a, puis on re-GRANT le
-- UPDATE sur la liste blanche exacte des colonnes éditables par le manager
-- (Mon organisation > Informations légales / Logo). Les colonnes hors liste
-- (tarif_refacture_pax_zd, grille_tarifaire_zd_id, type, actif, est_shadow,
-- cree_par_organisation_id, notes_internes) restent réservées au staff, qui
-- écrit via service_role (createAdminSupabaseClient) — privilèges séparés.
--
-- ⚠ Un simple REVOKE UPDATE (tarif_refacture_pax_zd) est INOPÉRANT tant que le
-- privilège UPDATE *table-level* subsiste (le grant table couvre toutes les
-- colonnes et prime). On retire donc d'abord le UPDATE table-level, PUIS on
-- re-GRANT sur la liste blanche.
REVOKE UPDATE ON plateforme.organisations FROM authenticated;
GRANT UPDATE (
  nom,
  raison_sociale,
  email_principal,
  telephone,
  adresse,
  siret,
  logo_url,
  updated_at
) ON plateforme.organisations TO authenticated;

COMMENT ON COLUMN plateforme.organisations.tarif_refacture_pax_zd IS
  'Tarif refacturé €/pax ZD (KPI Marge dashboard traiteur). Lecture traiteur, écriture Admin Savr only (M3.1 : retiré du GRANT UPDATE authenticated). Défaut 1.50.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Benchmark grain single_collecte — fiche collecte Bloc 3 ZD
-- ─────────────────────────────────────────────────────────────────────────────
-- La fiche collecte ZD terminée affiche les jauges kg/pax de CETTE collecte vs
-- la moyenne parc Savr (point rouge benchmark). On réutilise le segment
-- (bracket du pax de la collecte) pour comparer aux mêmes 4 dimensions.
--
-- SECURITY DEFINER (bypass RLS pour calculer le benchmark parc complet, k-anonymat
-- ≥5 hérité de f_benchmark_kg_pax_zd) MAIS on vérifie d'abord manuellement que le
-- caller a le droit de voir la collecte demandée — sinon RAISE EXCEPTION fail-fast
-- (la collecte d'une autre org n'est pas accessible via RLS, on réplique le
-- prédicat de visibilité collectes §09 : org propriétaire OU traiteur opérationnel,
-- staff = tout). Le filtre traiteur_ids[] n'existe pas ici (motif concurrentiel).
CREATE OR REPLACE FUNCTION plateforme.f_benchmark_single_collecte(
  p_collecte_id uuid
) RETURNS TABLE (
  flux_code     text,
  bracket       text,
  valeur_kg_pax numeric,   -- ratio de CETTE collecte (kg flux / pax événement)
  median_kg_pax numeric,   -- médiane parc Savr (benchmark, NULL si k-anonymat <5)
  nb_collectes  integer    -- taille segment parc (>=5 si benchmark visible)
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
DECLARE
  v_role    text := auth.jwt()->>'role';
  v_org     uuid := (auth.jwt()->>'organisation_id')::uuid;
  v_evt_org uuid;
  v_evt_top uuid;
  v_pax     integer;
  v_bracket text;
BEGIN
  -- Vérification de visibilité (RLS répliquée — fail fast si non accessible)
  SELECT e.organisation_id, e.traiteur_operationnel_organisation_id, e.pax
    INTO v_evt_org, v_evt_top, v_pax
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  WHERE c.id = p_collecte_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collecte not accessible';
  END IF;

  IF v_role NOT IN ('admin_savr', 'ops_savr')
     AND v_org IS DISTINCT FROM v_evt_org
     AND v_org IS DISTINCT FROM v_evt_top THEN
    RAISE EXCEPTION 'Collecte not accessible';
  END IF;

  v_bracket := plateforme.taille_evenement_bracket(v_pax);

  RETURN QUERY
  WITH valeurs AS (
    -- ratio kg/pax de la collecte courante, par flux
    SELECT fd.code AS flux_code,
           cf.poids_reel_kg / NULLIF(v_pax, 0) AS valeur_kg_pax
    FROM plateforme.collecte_flux cf
    JOIN plateforme.flux_dechets fd ON fd.id = cf.flux_id
    WHERE cf.collecte_id = p_collecte_id
      AND cf.poids_reel_kg IS NOT NULL
  )
  SELECT
    v.flux_code,
    v_bracket,
    v.valeur_kg_pax,
    b.median_kg_pax,
    COALESCE(b.nb_collectes, 0)
  FROM valeurs v
  LEFT JOIN plateforme.f_benchmark_kg_pax_zd(v_bracket) b
         ON b.flux_code = v.flux_code;
END $$;

REVOKE EXECUTE ON FUNCTION plateforme.f_benchmark_single_collecte(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_benchmark_single_collecte(uuid)
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Templates emails admin (§06.04 Bloc 4 AG + §Annulation chemin B)
-- ─────────────────────────────────────────────────────────────────────────────
-- admin_demande_renouvellement_pack : notification Admin Savr quand un traiteur
--   demande le renouvellement de son pack AG (bouton dashboard onglet AG).
-- admin_demande_annulation : notification Admin Savr sur demande d'annulation
--   d'une collecte validee (chemin B, validation Admin requise).
-- Vouvoiement, FR, 0 emoji, signature « L'équipe Savr » (charte §06.02).
INSERT INTO plateforme.email_templates (code, sujet, corps_html, actif, description, variables) VALUES
(
  'admin_demande_renouvellement_pack',
  'Demande de renouvellement de pack Anti-Gaspi',
  '<p>Bonjour,</p><p>L''organisation {{organisation_nom}} ({{demandeur_nom}}, {{demandeur_email}}) demande le renouvellement de son pack Anti-Gaspi.</p><p>Pack souhaité : {{pack_souhaite}}</p><p>Message : {{message}}</p><p>L''équipe Savr</p>',
  true,
  'Notification Admin Savr — demande de renouvellement de pack AG depuis le dashboard traiteur (§06.04 Bloc 4 AG).',
  ARRAY['organisation_nom','demandeur_nom','demandeur_email','pack_souhaite','message']
),
(
  'admin_demande_annulation',
  'Demande d''annulation de collecte',
  '<p>Bonjour,</p><p>L''organisation {{organisation_nom}} ({{demandeur_nom}}) demande l''annulation de la collecte {{collecte_ref}} prévue le {{date_collecte}}.</p><p>Motif : {{motif}}</p><p>Merci de valider ou refuser cette demande depuis le back-office.</p><p>L''équipe Savr</p>',
  true,
  'Notification Admin Savr — demande d''annulation d''une collecte validee (§06.04 Annulation chemin B).',
  ARRAY['organisation_nom','demandeur_nom','collecte_ref','date_collecte','motif']
)
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. v_kpi_traiteur — exposition pax_total (KPI kg/pax ZD + Pax cumulés AG)
-- ─────────────────────────────────────────────────────────────────────────────
-- M3.5 calculait déjà les pax distincts par événement pour la marge ZD, mais ne
-- les exposait pas. Le Bloc 1 dashboard a besoin du pax cumulé (DISTINCT par
-- événement) pour : kg/pax moyen (ZD) et Pax cumulés (AG). Recréation additive
-- (colonne pax_total ajoutée en fin — ordre des colonnes existantes préservé).
DROP VIEW IF EXISTS plateforme.v_kpi_traiteur;

CREATE VIEW plateforme.v_kpi_traiteur
  WITH (security_invoker = true)
AS
WITH tpc AS (
  SELECT collecte_id, SUM(COALESCE(poids_reel_kg, 0)) AS tonnage_kg
  FROM plateforme.collecte_flux
  GROUP BY collecte_id
),
base AS (
  SELECT
    e.organisation_id,
    date_trunc('month', c.date_collecte)::date AS mois,
    c.id                                        AS collecte_id,
    c.type                                      AS type_collecte,
    e.id                                        AS evenement_id,
    e.pax,
    COALESCE(tpc.tonnage_kg, 0)                 AS tonnage_kg,
    c.taux_recyclage,
    c.co2_induit_kg,
    c.co2_evite_kg,
    c.co2_net_kg,
    c.energie_primaire_evitee_kwh,
    COALESCE(aa.volume_repas_realise, 0)        AS volume_repas_realise
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  LEFT JOIN tpc ON tpc.collecte_id = c.id
  LEFT JOIN plateforme.attributions_antgaspi aa ON aa.collecte_id = c.id
  WHERE c.statut = 'cloturee'
),
-- PAX distincts par événement, par type (ZD pour marge + kg/pax, AG pour cumul)
pax_par_type AS (
  SELECT organisation_id, mois, type_collecte, SUM(pax) AS pax_total
  FROM (
    SELECT DISTINCT ON (organisation_id, mois, type_collecte, evenement_id)
      organisation_id, mois, type_collecte, evenement_id, pax
    FROM base
  ) x
  GROUP BY organisation_id, mois, type_collecte
),
factures_zd AS (
  SELECT
    e.organisation_id,
    date_trunc('month', c.date_collecte)::date AS mois,
    SUM(fc.montant_ht)                          AS montant_ht
  FROM plateforme.factures_collectes fc
  JOIN plateforme.collectes c ON c.id = fc.collecte_id
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  JOIN plateforme.factures f ON f.id = fc.facture_id
  WHERE c.type = 'zero_dechet'
    AND c.statut = 'cloturee'
    AND f.statut IN ('emise', 'payee')
  GROUP BY e.organisation_id, date_trunc('month', c.date_collecte)
),
agg AS (
  SELECT
    b.organisation_id,
    b.mois,
    b.type_collecte,
    COUNT(DISTINCT b.collecte_id) AS nb_collectes,
    SUM(CASE WHEN b.type_collecte = 'zero_dechet' THEN b.tonnage_kg END) AS tonnage_kg,
    CASE WHEN SUM(CASE WHEN b.type_collecte = 'zero_dechet' AND b.taux_recyclage IS NOT NULL
                        THEN b.tonnage_kg END) > 0
         THEN SUM(CASE WHEN b.type_collecte = 'zero_dechet' AND b.taux_recyclage IS NOT NULL
                        THEN b.taux_recyclage * b.tonnage_kg END) /
              SUM(CASE WHEN b.type_collecte = 'zero_dechet' AND b.taux_recyclage IS NOT NULL
                        THEN b.tonnage_kg END)
         ELSE NULL
    END AS taux_recyclage_pondere,
    SUM(CASE WHEN b.type_collecte = 'anti_gaspi' THEN b.volume_repas_realise END) AS nb_repas_donnes,
    SUM(b.co2_induit_kg)             AS co2_induit_kg,
    SUM(b.co2_evite_kg)              AS co2_evite_kg,
    SUM(b.co2_net_kg)                AS co2_net_kg,
    SUM(b.energie_primaire_evitee_kwh) AS energie_primaire_evitee_kwh
  FROM base b
  GROUP BY b.organisation_id, b.mois, b.type_collecte
)
SELECT
  a.organisation_id,
  a.mois,
  a.type_collecte,
  a.nb_collectes,
  a.tonnage_kg,
  a.taux_recyclage_pondere,
  a.nb_repas_donnes,
  a.co2_induit_kg,
  a.co2_evite_kg,
  a.co2_net_kg,
  a.energie_primaire_evitee_kwh,
  CASE WHEN a.type_collecte = 'zero_dechet' AND COALESCE(ppt.pax_total, 0) > 0
       THEN o.tarif_refacture_pax_zd * ppt.pax_total
            - COALESCE(fzd.montant_ht, 0)
  END AS marge_zd_ht,
  COALESCE(ppt.pax_total, 0) AS pax_total
FROM agg a
JOIN plateforme.organisations o ON o.id = a.organisation_id
LEFT JOIN pax_par_type ppt
       ON ppt.organisation_id = a.organisation_id
      AND ppt.mois = a.mois
      AND ppt.type_collecte = a.type_collecte
LEFT JOIN factures_zd fzd
       ON fzd.organisation_id = a.organisation_id AND fzd.mois = a.mois;

GRANT SELECT ON plateforme.v_kpi_traiteur TO authenticated;

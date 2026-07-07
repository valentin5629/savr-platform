-- R20a — v_kpi_admin : montant AG = CA « économique » (coût par collecte du pack)
-- ============================================================================
-- Décision Val 2026-07-07 (divergence CDC §11 §1.1 tracée, cf. _Divergences) :
-- l'histogramme Revenus admin (et le tableau « Revenus par organisation ») doit
-- montrer, pour l'anti-gaspi, le revenu de SERVICE LIVRÉ amorti par collecte —
-- pas la facture d'achat de pack (cash, concentrée le jour de l'achat).
--
--   Montant AG (mois M) = Σ sur les collectes AG livrées en M (realisee/cloturee)
--                         de (pack.prix_unitaire_ht ≈ montant_total_ht / crédits).
--
-- Le montant ZD reste inchangé (factures emises/payees par date_emission, §11 §1.1).
-- La colonne `montant_factures_ht` conserve son nom (consommée par RevenusHistogramme).
-- ============================================================================

DROP VIEW IF EXISTS plateforme.v_kpi_admin;

CREATE VIEW plateforme.v_kpi_admin
  WITH (security_invoker = true)
AS
-- Nb collectes par mois/type (inchangé) — date_collecte, hors annulee/brouillon.
WITH collectes_agg AS (
  SELECT
    date_trunc('month', c.date_collecte)::date AS mois,
    c.type::text                                AS type_collecte,
    COUNT(c.id)                                 AS nb_collectes,
    COUNT(CASE WHEN c.statut = 'cloturee' THEN 1 END) AS nb_cloturees
  FROM plateforme.collectes c
  WHERE c.statut NOT IN ('annulee', 'brouillon')
  GROUP BY date_trunc('month', c.date_collecte), c.type
),
-- ── ZD : revenu comptable = factures emises/payees par date_emission (§11 §1.1) ──
revenus_zd_directs AS (
  SELECT
    date_trunc('month', f.date_emission)::date AS mois,
    SUM(f.montant_ht)                          AS montant_ht
  FROM plateforme.factures f
  WHERE f.statut IN ('emise', 'payee')
    AND f.date_emission IS NOT NULL
    AND f.type = 'zero_dechet'
  GROUP BY date_trunc('month', f.date_emission)
),
-- Avoirs ZD comptés négatifs sur leur mois d'émission, rattachés au type d'origine.
revenus_zd_avoirs AS (
  SELECT
    date_trunc('month', f.date_emission)::date AS mois,
    SUM(-f.montant_ht)                         AS montant_ht
  FROM plateforme.factures f
  JOIN plateforme.factures f_orig ON f_orig.id = f.facture_origine_id
  WHERE f.statut IN ('emise', 'payee')
    AND f.date_emission IS NOT NULL
    AND f.type = 'avoir'
    AND f_orig.type = 'zero_dechet'
  GROUP BY date_trunc('month', f.date_emission)
),
revenus_zd AS (
  SELECT mois, SUM(montant_ht) AS montant_ht
  FROM (
    SELECT mois, montant_ht FROM revenus_zd_directs
    UNION ALL
    SELECT mois, montant_ht FROM revenus_zd_avoirs
  ) z
  GROUP BY mois
),
-- ── AG : CA économique = coût par collecte du pack, par date_collecte livrée ──
-- Coût/collecte = prix_unitaire_ht (fallback montant_total_ht / crédits). Une collecte
-- AG consomme un crédit à `realisee` → revenu reconnu sur les collectes realisee/cloturee.
-- CONSÉQUENCE de la décision (divergence Val 2026-07-07) : les factures d'achat de pack
-- (type='achat_pack_antigaspi') ET leurs avoirs ne sont PLUS lus ici — le montant AG du
-- dashboard est le service livré, pas le cash. Le revenu comptable (facture d'achat +
-- avoir éventuel) reste dans le module Facturation. L'ancienne v_kpi_admin sommait ces
-- factures/avoirs pour l'AG : ce changement est volontaire et tracé (cf. _Divergences).
revenus_ag AS (
  SELECT
    date_trunc('month', c.date_collecte)::date AS mois,
    SUM(COALESCE(
          p.prix_unitaire_ht,
          p.montant_total_ht / NULLIF(p.credits_initiaux, 0)
        ))                                     AS montant_ht
  FROM plateforme.collectes c
  JOIN plateforme.packs_antgaspi p ON p.id = c.pack_antgaspi_id
  WHERE c.type = 'anti_gaspi'
    AND c.statut IN ('realisee', 'cloturee')
  GROUP BY date_trunc('month', c.date_collecte)
),
revenus_agg AS (
  SELECT mois, 'zero_dechet'::text AS type_collecte, montant_ht FROM revenus_zd
  UNION ALL
  SELECT mois, 'anti_gaspi'::text  AS type_collecte, montant_ht FROM revenus_ag
)
SELECT
  COALESCE(ca.mois, ra.mois)                   AS mois,
  COALESCE(ca.type_collecte, ra.type_collecte) AS type_collecte,
  COALESCE(ca.nb_collectes, 0)                 AS nb_collectes,
  COALESCE(ca.nb_cloturees, 0)                 AS nb_cloturees,
  COALESCE(ra.montant_ht, 0)                   AS montant_factures_ht
FROM collectes_agg ca
FULL OUTER JOIN revenus_agg ra
  ON ra.mois = ca.mois AND ra.type_collecte = ca.type_collecte;

-- v_kpi_admin accessible via service_role uniquement (createAdminSupabaseClient).
GRANT SELECT ON plateforme.v_kpi_admin TO service_role;

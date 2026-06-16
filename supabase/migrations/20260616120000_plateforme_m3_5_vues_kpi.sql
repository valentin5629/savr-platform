-- M3.5 — Vues KPI dashboards (couche commune)
-- Crée : v_kpi_traiteur, v_kpi_lieu, v_kpi_admin, v_kpi_client_organisateur
-- Toutes SECURITY INVOKER (RLS des tables sources s'applique au caller)
-- Sobriété A1 : vues calculées à la volée, pas de matérialisation (sauf benchmark existant)

-- ─── Index manquants sur les tables sources ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_collectes_statut_date
  ON plateforme.collectes (statut, date_collecte);

CREATE INDEX IF NOT EXISTS idx_collectes_statut_type_date
  ON plateforme.collectes (statut, type, date_collecte);

CREATE INDEX IF NOT EXISTS idx_evenements_client_org
  ON plateforme.evenements (client_organisateur_organisation_id)
  WHERE client_organisateur_organisation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_factures_statut_date_emission
  ON plateforme.factures (statut, date_emission)
  WHERE statut IN ('emise', 'payee');

CREATE INDEX IF NOT EXISTS idx_factures_collectes_facture
  ON plateforme.factures_collectes (facture_id);

-- ─── VIEW : v_kpi_traiteur ──────────────────────────────────────────────────
-- Agrégats par (organisation_id, mois, type_collecte) — collectes cloturees.
-- Marge ZD = tarif_refacture_pax_zd × pax distincts par événement − Σ factures HT emises/payees.

DROP VIEW IF EXISTS plateforme.v_kpi_traiteur;

CREATE VIEW plateforme.v_kpi_traiteur
  WITH (security_invoker = true)
AS
WITH tpc AS (
  -- Tonnage total par collecte
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
-- PAX distincts par événement ZD (pour calcul marge)
pax_zd AS (
  SELECT organisation_id, mois, SUM(pax) AS pax_total_zd
  FROM (
    SELECT DISTINCT ON (organisation_id, mois, evenement_id)
      organisation_id, mois, evenement_id, pax
    FROM base
    WHERE type_collecte = 'zero_dechet'
  ) x
  GROUP BY organisation_id, mois
),
-- Factures ZD emises/payees liées aux collectes cloturees
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
    -- Taux recyclage pondéré par tonnage (exclut collectes sans taux)
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
  -- Marge ZD (NULL pour AG rows ou pax = 0)
  CASE WHEN a.type_collecte = 'zero_dechet' AND COALESCE(pz.pax_total_zd, 0) > 0
       THEN o.tarif_refacture_pax_zd * pz.pax_total_zd
            - COALESCE(fzd.montant_ht, 0)
  END AS marge_zd_ht
FROM agg a
JOIN plateforme.organisations o ON o.id = a.organisation_id
LEFT JOIN pax_zd pz
       ON pz.organisation_id = a.organisation_id AND pz.mois = a.mois
LEFT JOIN factures_zd fzd
       ON fzd.organisation_id = a.organisation_id AND fzd.mois = a.mois;

GRANT SELECT ON plateforme.v_kpi_traiteur TO authenticated;

-- ─── VIEW : v_kpi_lieu ──────────────────────────────────────────────────────
-- Agrégats par (lieu_id, mois, type_collecte) — collectes cloturees.

DROP VIEW IF EXISTS plateforme.v_kpi_lieu;

CREATE VIEW plateforme.v_kpi_lieu
  WITH (security_invoker = true)
AS
WITH tpc AS (
  SELECT collecte_id, SUM(COALESCE(poids_reel_kg, 0)) AS tonnage_kg
  FROM plateforme.collecte_flux
  GROUP BY collecte_id
),
base AS (
  SELECT
    e.lieu_id,
    e.organisation_id,
    date_trunc('month', c.date_collecte)::date AS mois,
    c.id                                        AS collecte_id,
    c.type                                      AS type_collecte,
    e.pax,
    COALESCE(tpc.tonnage_kg, 0)                 AS tonnage_kg,
    c.taux_recyclage,
    c.co2_evite_kg,
    c.co2_net_kg,
    COALESCE(aa.volume_repas_realise, 0)        AS volume_repas_realise
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  LEFT JOIN tpc ON tpc.collecte_id = c.id
  LEFT JOIN plateforme.attributions_antgaspi aa ON aa.collecte_id = c.id
  WHERE c.statut = 'cloturee'
)
SELECT
  b.lieu_id,
  b.mois,
  b.type_collecte,
  COUNT(DISTINCT b.collecte_id)                 AS nb_collectes,
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
  SUM(b.co2_evite_kg)  AS co2_evite_kg,
  SUM(b.co2_net_kg)    AS co2_net_kg
FROM base b
GROUP BY b.lieu_id, b.mois, b.type_collecte;

GRANT SELECT ON plateforme.v_kpi_lieu TO authenticated;

-- ─── VIEW : v_kpi_admin ─────────────────────────────────────────────────────
-- Agrégats globaux par (mois, type_collecte) — utilisé pour l'histogramme revenus 12 mois.
-- Cartes-actions Bloc 1 = calculées directement dans l'API (données live, pas historiques).

DROP VIEW IF EXISTS plateforme.v_kpi_admin;

CREATE VIEW plateforme.v_kpi_admin
  WITH (security_invoker = true)
AS
-- Agrégats collectes par mois/type
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
-- Revenus ZD/AG (hors avoirs) par mois/type
-- f.type : 'zero_dechet' | 'collecte_antigaspi' | 'achat_pack_antigaspi' | 'avoir'
-- (plateforme.facture_type — colonne ajoutée en M1.7 ; f.serie n'existe PAS sur factures)
revenus_directs AS (
  SELECT
    date_trunc('month', f.date_emission)::date AS mois,
    CASE
      WHEN f.type = 'zero_dechet'                                  THEN 'zero_dechet'
      WHEN f.type IN ('collecte_antigaspi', 'achat_pack_antigaspi') THEN 'anti_gaspi'
    END AS type_collecte,
    SUM(f.montant_ht) AS montant_ht
  FROM plateforme.factures f
  WHERE f.statut IN ('emise', 'payee')
    AND f.date_emission IS NOT NULL
    AND f.type != 'avoir'
  GROUP BY date_trunc('month', f.date_emission), f.type
),
-- Avoirs comptés négatifs, rattachés au type de la facture d'origine (§11 §1.1 F5)
avoirs AS (
  SELECT
    date_trunc('month', f.date_emission)::date AS mois,
    CASE
      WHEN f_orig.type = 'zero_dechet'                                  THEN 'zero_dechet'
      WHEN f_orig.type IN ('collecte_antigaspi', 'achat_pack_antigaspi') THEN 'anti_gaspi'
    END AS type_collecte,
    SUM(-f.montant_ht) AS montant_ht
  FROM plateforme.factures f
  JOIN plateforme.factures f_orig ON f_orig.id = f.facture_origine_id
  WHERE f.statut IN ('emise', 'payee')
    AND f.date_emission IS NOT NULL
    AND f.type = 'avoir'
  GROUP BY date_trunc('month', f.date_emission),
           CASE
             WHEN f_orig.type = 'zero_dechet'                                  THEN 'zero_dechet'
             WHEN f_orig.type IN ('collecte_antigaspi', 'achat_pack_antigaspi') THEN 'anti_gaspi'
           END
),
-- Fusion revenus directs + avoirs par (mois, type)
revenus_agg AS (
  SELECT mois, type_collecte, SUM(montant_ht) AS montant_ht
  FROM (
    SELECT mois, type_collecte, montant_ht FROM revenus_directs
    UNION ALL
    SELECT mois, type_collecte, montant_ht FROM avoirs WHERE type_collecte IS NOT NULL
  ) combined
  GROUP BY mois, type_collecte
)
SELECT
  COALESCE(ca.mois, ra.mois)             AS mois,
  COALESCE(ca.type_collecte, ra.type_collecte) AS type_collecte,
  COALESCE(ca.nb_collectes, 0)           AS nb_collectes,
  COALESCE(ca.nb_cloturees, 0)           AS nb_cloturees,
  COALESCE(ra.montant_ht, 0)             AS montant_factures_ht
FROM collectes_agg ca
FULL OUTER JOIN revenus_agg ra
  ON ra.mois = ca.mois AND ra.type_collecte = ca.type_collecte;

-- v_kpi_admin accessible via service_role uniquement (createAdminSupabaseClient) — pas d'accès authenticated direct
GRANT SELECT ON plateforme.v_kpi_admin TO service_role;

-- ─── VIEW : v_kpi_client_organisateur ───────────────────────────────────────
-- Agrégats par (client_organisateur_organisation_id, mois, type_collecte).
-- Uniquement les événements avec client_organisateur_organisation_id renseigné.

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
    c.co2_evite_kg,
    c.co2_net_kg,
    COALESCE(aa.volume_repas_realise, 0)         AS volume_repas_realise
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  LEFT JOIN tpc ON tpc.collecte_id = c.id
  LEFT JOIN plateforme.attributions_antgaspi aa ON aa.collecte_id = c.id
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
  -- CO2 (toutes collectes)
  SUM(b.co2_evite_kg) AS co2_evite_kg,
  SUM(b.co2_net_kg)   AS co2_net_kg
FROM base b
GROUP BY b.organisation_id, b.mois, b.type_collecte;

GRANT SELECT ON plateforme.v_kpi_client_organisateur TO authenticated;

-- ─── Fonction refresh mv_benchmark (appelée par le cron Vercel) ─────────────

CREATE OR REPLACE FUNCTION plateforme.refresh_mv_benchmark()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
BEGIN
  REFRESH MATERIALIZED VIEW plateforme.mv_benchmark_kg_pax_zd_base;
END $$;

REVOKE EXECUTE ON FUNCTION plateforme.refresh_mv_benchmark() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.refresh_mv_benchmark() TO service_role;

-- SELECT direct sur la mv refusé à authenticated/anon (le blanket grant 0.4a l'avait
-- exposée par erreur) : l'accès benchmark passe uniquement par f_benchmark_kg_pax_zd()
-- (SECURITY DEFINER, k-anonymat). Cf. test M3.5 T10.
REVOKE ALL ON plateforme.mv_benchmark_kg_pax_zd_base FROM authenticated, anon;

-- Durcissement SECURITY DEFINER (§12) : le REVOKE ci-dessus reporte toute la
-- sécurité benchmark sur f_benchmark_kg_pax_zd(). Cette fonction (créée bloc8,
-- SECURITY DEFINER) n'avait pas de search_path figé → risque de résolution
-- d'objet non qualifié vers un schéma attaquant. On le fige ici (la fonction
-- est déjà appliquée en base, sa migration d'origine est immuable).
ALTER FUNCTION plateforme.f_benchmark_kg_pax_zd(text, text)
  SET search_path = plateforme, pg_catalog;

-- ─── RLS factures : lecture client org-scopée (corrige dette 0.4c) ───────────
-- La vue v_factures_client (0.4c, SECURITY INVOKER) suppose explicitement que
-- « les prédicats org-scoped s'appliquent via les policies de la table factures »,
-- mais aucune policy SELECT client n'avait été créée → v_factures_client renvoie 0
-- ligne pour les clients ET la marge de v_kpi_traiteur (SECURITY INVOKER) ne peut
-- pas soustraire les factures. Policy org-scopée alignée sur le WHERE de
-- v_factures_client (mêmes rôles, même périmètre organisation).
CREATE POLICY fac_client_select ON plateforme.factures
  FOR SELECT USING (
    auth.jwt()->>'role' IN ('traiteur_manager', 'traiteur_commercial', 'agence', 'gestionnaire_lieux')
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

-- ⚠ Masquage F5 (§09 §3) — RESTRICTION AU NIVEAU COLONNE (privilège).
-- La RLS filtre les LIGNES, jamais les colonnes : sans cette restriction, la
-- policy fac_client_select ci-dessus + le blanket GRANT 0.4a (SELECT table-level)
-- laisseraient un rôle client lire en SELECT direct la marge interne Savr et les
-- détails de synchro Pennylane sur sa propre org (contournement de
-- v_factures_client, qui exclut ces colonnes).
--
-- ⚠ Un simple `REVOKE SELECT (colonnes)` est INOPÉRANT tant que le privilège
-- SELECT *table-level* subsiste (PostgreSQL : le grant table couvre toutes les
-- colonnes et prime sur un revoke colonne). On retire donc d'abord le SELECT
-- table-level hérité du blanket grant 0.4a, PUIS on re-GRANT le SELECT sur la
-- liste blanche exacte des colonnes non sensibles — strictement les 26 colonnes
-- exposées par v_factures_client (cf. 20260615000100 M1.7 lignes 152-178).
-- Les colonnes sensibles (marge_logistique, erreur_synchro, erreur_synchro_at,
-- derniere_tentative_pennylane_at, pennylane_statut, pennylane_push_at) restent
-- ainsi illisibles au rôle authenticated. Le staff (admin/ops) lit factures via
-- service_role (createAdminSupabaseClient) → privilèges séparés, non impactés.
-- Test : T11 (deny SELECT marge_logistique direct) + T12 (claim org absent).
REVOKE SELECT ON plateforme.factures FROM authenticated;
GRANT SELECT (
  id,
  organisation_id,
  entite_facturation_id,
  numero_facture,
  facture_origine_id,
  type,
  mode_facturation,
  pack_antgaspi_id,
  statut,
  montant_ht,
  taux_tva,
  montant_tva,
  montant_ttc,
  devise,
  pennylane_id,
  pdf_url_pennylane,
  pdf_url_savr,
  motif_avoir,
  notes,
  periode_debut,
  periode_fin,
  date_emission,
  date_echeance,
  date_paiement,
  created_at,
  updated_at
) ON plateforme.factures TO authenticated;

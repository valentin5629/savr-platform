-- Lot 3 du pax porté par la collecte (décisions Val Q1, Q2, Q3 et Q5 du 2026-10-25).
--
-- v_kpi_traiteur (cartes et sparklines des dashboards traiteur et agence) lisait
-- le pax des ÉVÉNEMENTS distincts : un événement de deux soirées comptait les deux
-- soirées dans chaque onglet, une AG du même soir plus grosse que la ZD gonflait le
-- pax de l'onglet ZD. Elle lit désormais le pax des COLLECTES de la ligne :
--   - pax_total = Σ collectes.pax des collectes clôturées du mois et du type de la
--     ligne (ZD ou AG, jamais l'autre) ; une collecte à 0 convive n'y ajoute rien ;
--   - marge_zd_ht = tarif × Σ pax des collectes ZD clôturées − Σ factures HT ZD
--     émises ou payées (Q3 ; la carte reste masquée, décision Val 2026-07-13) ;
--   - deux colonnes ajoutées EN FIN de vue, numérateurs des ratios par pax : le
--     poids (ZD) et les repas (AG) des seules collectes à convives connus — une
--     collecte à 0 convive (reprise Bubble) sort du numérateur ET du dénominateur
--     (Q1, Q2), comme du benchmark (lot C1, Q4 du 2026-10-24).
--
-- Corps repris de 20260918100000 ; seules changent la lecture du pax (CTE
-- pax_par_type supprimée, pax sommé dans agg) et les deux colonnes ajoutées.
-- Colonnes existantes : noms, ordre et types inchangés. security_invoker reposé
-- (CREATE OR REPLACE VIEW remplace les options de la vue) ; droits inchangés
-- (CREATE OR REPLACE VIEW conserve les GRANT existants). La marge lit toujours le
-- tarif par plateforme.f_tarif_refacture_pax_zd (NULL hors traiteur propriétaire
-- et staff, 20260918100000) : rien n'est élargi.
--
-- v_kpi_lieu n'est pas touchée (Q5) : elle lit evenements.pax dans une CTE mais
-- ne le renvoie dans aucune colonne, et aucun code ne la lit plus.

CREATE OR REPLACE VIEW plateforme.v_kpi_traiteur
  WITH (security_invoker = true) AS
 WITH tpc AS (
         SELECT collecte_flux.collecte_id,
            sum(COALESCE(collecte_flux.poids_reel_kg, 0::numeric)) AS tonnage_kg
           FROM plateforme.collecte_flux
          GROUP BY collecte_flux.collecte_id
        ), base AS (
         SELECT e.organisation_id,
            date_trunc('month'::text, c.date_collecte::timestamp with time zone)::date AS mois,
            c.id AS collecte_id,
            c.type AS type_collecte,
            COALESCE(c.pax, 0) AS pax,
            COALESCE(tpc.tonnage_kg, 0::numeric) AS tonnage_kg,
            c.taux_recyclage,
            c.co2_induit_kg,
            c.co2_evite_kg,
            c.co2_net_kg,
            c.energie_primaire_evitee_kwh,
            COALESCE(aa.volume_repas_realise, 0) AS volume_repas_realise
           FROM plateforme.collectes c
             JOIN plateforme.evenements e ON e.id = c.evenement_id
             LEFT JOIN tpc ON tpc.collecte_id = c.id
             LEFT JOIN plateforme.attributions_antgaspi aa ON aa.collecte_id = c.id
          WHERE c.statut = 'cloturee'::plateforme.collecte_statut
        ), factures_zd AS (
         SELECT e.organisation_id,
            date_trunc('month'::text, c.date_collecte::timestamp with time zone)::date AS mois,
            sum(fc.montant_ht) AS montant_ht
           FROM plateforme.factures_collectes fc
             JOIN plateforme.collectes c ON c.id = fc.collecte_id
             JOIN plateforme.evenements e ON e.id = c.evenement_id
             JOIN plateforme.factures f ON f.id = fc.facture_id
          WHERE c.type = 'zero_dechet'::plateforme.collecte_type AND c.statut = 'cloturee'::plateforme.collecte_statut AND (f.statut = ANY (ARRAY['emise'::plateforme.facture_statut, 'payee'::plateforme.facture_statut]))
          GROUP BY e.organisation_id, (date_trunc('month'::text, c.date_collecte::timestamp with time zone))
        ), agg AS (
         SELECT b.organisation_id,
            b.mois,
            b.type_collecte,
            count(DISTINCT b.collecte_id) AS nb_collectes,
            sum(
                CASE
                    WHEN b.type_collecte = 'zero_dechet'::plateforme.collecte_type THEN b.tonnage_kg
                    ELSE NULL::numeric
                END) AS tonnage_kg,
                CASE
                    WHEN sum(
                    CASE
                        WHEN b.type_collecte = 'zero_dechet'::plateforme.collecte_type AND b.taux_recyclage IS NOT NULL THEN b.tonnage_kg
                        ELSE NULL::numeric
                    END) > 0::numeric THEN sum(
                    CASE
                        WHEN b.type_collecte = 'zero_dechet'::plateforme.collecte_type AND b.taux_recyclage IS NOT NULL THEN b.taux_recyclage * b.tonnage_kg
                        ELSE NULL::numeric
                    END) / sum(
                    CASE
                        WHEN b.type_collecte = 'zero_dechet'::plateforme.collecte_type AND b.taux_recyclage IS NOT NULL THEN b.tonnage_kg
                        ELSE NULL::numeric
                    END)
                    ELSE NULL::numeric
                END AS taux_recyclage_pondere,
            sum(
                CASE
                    WHEN b.type_collecte = 'anti_gaspi'::plateforme.collecte_type THEN b.volume_repas_realise
                    ELSE NULL::integer
                END) AS nb_repas_donnes,
            sum(b.co2_induit_kg) AS co2_induit_kg,
            sum(b.co2_evite_kg) AS co2_evite_kg,
            sum(b.co2_net_kg) AS co2_net_kg,
            sum(b.energie_primaire_evitee_kwh) AS energie_primaire_evitee_kwh,
            sum(b.pax) AS pax_total,
            sum(
                CASE
                    WHEN b.type_collecte = 'zero_dechet'::plateforme.collecte_type AND b.pax > 0 THEN b.tonnage_kg
                    ELSE NULL::numeric
                END) AS tonnage_kg_pax_connu,
            sum(
                CASE
                    WHEN b.type_collecte = 'anti_gaspi'::plateforme.collecte_type AND b.pax > 0 THEN b.volume_repas_realise
                    ELSE NULL::integer
                END) AS nb_repas_pax_connu
           FROM base b
          GROUP BY b.organisation_id, b.mois, b.type_collecte
        )
 SELECT a.organisation_id,
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
        CASE
            WHEN a.type_collecte = 'zero_dechet'::plateforme.collecte_type AND COALESCE(a.pax_total, 0::bigint) > 0 THEN plateforme.f_tarif_refacture_pax_zd(o.id) * a.pax_total::numeric - COALESCE(fzd.montant_ht, 0::numeric)
            ELSE NULL::numeric
        END AS marge_zd_ht,
    COALESCE(a.pax_total, 0::bigint) AS pax_total,
    a.tonnage_kg_pax_connu,
    a.nb_repas_pax_connu
   FROM agg a
     JOIN plateforme.organisations o ON o.id = a.organisation_id
     LEFT JOIN factures_zd fzd ON fzd.organisation_id = a.organisation_id AND fzd.mois = a.mois;

COMMENT ON VIEW plateforme.v_kpi_traiteur IS
  'KPI mensuels par organisation et type de collecte (dashboards traiteur et agence). Pax au grain de la COLLECTE (lot 3, décisions Val du 2026-10-25) : pax_total = Σ collectes.pax des collectes clôturées de la ligne ; tonnage_kg_pax_connu et nb_repas_pax_connu = poids (ZD) et repas (AG) des seules collectes à convives connus, numérateurs de kg/pax et repas/pax (collecte à 0 convive écartée). marge_zd_ht = tarif (f_tarif_refacture_pax_zd) × pax_total − factures ZD émises ou payées.';

-- ROLLBACK : CREATE OR REPLACE ne peut pas revenir au corps de 20260918100000 (il
-- retirerait les deux colonnes de fin) : supprimer la vue, la recréer avec ce corps
-- (WITH security_invoker = true), puis reposer les droits relevés avant ce lot :
-- GRANT SELECT TO authenticated ; GRANT SELECT, INSERT, UPDATE, DELETE TO service_role.

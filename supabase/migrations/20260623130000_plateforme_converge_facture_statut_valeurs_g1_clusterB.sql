-- Convergence G1 (Frontière TMS-Ready) — CLUSTER B.2 : VALEURS de facture_statut_enum vers le cible.
-- Cible (specs/ddl-cible/schema_cible_v2.sql L136) :
--   plateforme.facture_statut AS ENUM ('brouillon','en_attente_pennylane','emise','payee','annulee')
-- V1 a 'envoyee' et 'en_retard' EN TROP. Ce lot converge NOM + VALEURS en une fois.
--
-- ⚠ PROD LIVE : Postgres ne sait pas DROP VALUE -> recréation du type + ALTER COLUMN USING <mapping>.
--   DÉCISION VAL (2026-06-22) : GO, mapping envoyee -> emise, en_retard -> emise. Le « retard »
--   devient un état DÉRIVÉ de la date d'échéance (plus un statut stocké). Aucun code n'ÉCRIT
--   'envoyee'/'en_retard' (grep SQL+TS = 0 writer ; tout le pipeline facturation écrit déjà
--   brouillon/en_attente_pennylane/emise/payee) -> le USING est un no-op si 0 ligne prod, sûr si > 0.
--   ⚠ Comptes prod (factures GROUP BY statut) = à collecter par Val avant le déploiement manuel
--   (accès prod interdit depuis dev — CLAUDE.md §11) ; la migration reste correcte quel que soit le compte.
--   PR front lockstep (revenus-organisations, exports/shared.ts, test, seed) dans la même PR.
--
-- Dépendances live du type (introspection pg_depend, 2026-06-22) :
--   • colonne factures.statut (DEFAULT 'brouillon')
--   • 3 index partiels dont les prédicats castent l'enum (toutes valeurs CIBLE-valides) :
--       idx_factures_emises_polling (WHERE statut='emise'),
--       idx_factures_attente_pennylane (WHERE statut='en_attente_pennylane'),
--       idx_factures_statut_date_emission (WHERE statut IN ('emise','payee'))
--   • index plain idx_factures_statut (btree statut) -> reconstruit AUTOMATIQUEMENT par l'ALTER TYPE
--   • 4 vues security_invoker dépendant de la COLONNE factures.statut (toutes droppées+recréées) :
--       v_factures_client (sort la colonne statut), v_ops_factures_bloquees (filtre 'envoyee'),
--       v_kpi_admin + v_kpi_traiteur (castent 'emise'/'payee'::facture_statut_enum dans le corps).
--       ⚠ Les 2 KPI dépendent du TYPE via cast littéral (pas en colonne de sortie) : un pg_depend
--       limité au type listait des rules « blank » non résolues -> c'est la dépendance de COLONNE
--       (ALTER COLUMN TYPE échoue sur toute vue référençant la colonne) qui fait foi (4 vues).
--   • 1 trigger référençant la colonne dans sa DÉFINITION : trg_avoir_annule_origine
--       (AFTER UPDATE OF statut) -> bloque l'ALTER COLUMN. Droppé+recréé ; sa fonction
--       fn_trg_avoir_annule_origine NE cast PAS le type (pg_proc.prosrc = 0) -> pas de recréation.
--   • 0 fonction castant le type, 0 CHECK, 0 colonne générée, 0 policy RLS référençant ces valeurs.
--
-- v_ops_factures_bloquees : filtre actuellement statut='envoyee'. Intention documentée = « factures
--   émises SANS RETOUR PENNYLANE depuis > 48h ». Dans le modèle cible, l'état « en attente de retour
--   Pennylane » est en_attente_pennylane (et NON emise = Pennylane déjà confirmé). La vue est de plus
--   ACTUELLEMENT MORTE (aucun code n'écrit 'envoyee'). -> recréée sur statut='en_attente_pennylane'
--   pour préserver l'intention et éviter de faux positifs sur toute facture émise impayée > 48h.

-- 1) Type cible
CREATE TYPE plateforme.facture_statut
  AS ENUM ('brouillon', 'en_attente_pennylane', 'emise', 'payee', 'annulee');

-- 2) Lever les dépendances bloquantes : 1 trigger (def) + 4 vues (colonne) + 3 index partiels.
DROP TRIGGER IF EXISTS trg_avoir_annule_origine ON plateforme.factures;
DROP VIEW  IF EXISTS plateforme.v_ops_factures_bloquees;
DROP VIEW  IF EXISTS plateforme.v_factures_client;
DROP VIEW  IF EXISTS plateforme.v_kpi_admin;
DROP VIEW  IF EXISTS plateforme.v_kpi_traiteur;
DROP INDEX IF EXISTS plateforme.idx_factures_emises_polling;
DROP INDEX IF EXISTS plateforme.idx_factures_attente_pennylane;
DROP INDEX IF EXISTS plateforme.idx_factures_statut_date_emission;

-- 3) Colonne : drop default -> type cible (mapping envoyee/en_retard -> emise) -> re-set default.
ALTER TABLE plateforme.factures ALTER COLUMN statut DROP DEFAULT;
ALTER TABLE plateforme.factures
  ALTER COLUMN statut TYPE plateforme.facture_statut
  USING (CASE WHEN statut::text IN ('envoyee', 'en_retard') THEN 'emise'
              ELSE statut::text END)::plateforme.facture_statut;
ALTER TABLE plateforme.factures ALTER COLUMN statut SET DEFAULT 'brouillon';

-- 4) Plus aucun objet n'utilise l'ancien type -> drop.
DROP TYPE plateforme.facture_statut_enum;

-- 5) Recréer les 3 index partiels (prédicats sur valeurs cible, identiques à l'état live).
CREATE INDEX idx_factures_emises_polling
  ON plateforme.factures (id)
  WHERE statut = 'emise';
CREATE INDEX idx_factures_attente_pennylane
  ON plateforme.factures (derniere_tentative_pennylane_at)
  WHERE statut = 'en_attente_pennylane';
CREATE INDEX idx_factures_statut_date_emission
  ON plateforme.factures (statut, date_emission)
  WHERE statut IN ('emise', 'payee');

-- 6) Recréer les 2 vues (security_invoker = true reproduit ; grants reproduits à l'identique).
--    v_factures_client : définition verbatim (pg_get_viewdef), aucune valeur de statut en dur.
CREATE VIEW plateforme.v_factures_client
  WITH (security_invoker = true) AS
  SELECT id,
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
  FROM plateforme.factures
  WHERE (plateforme.f_app_role() = ANY (ARRAY['traiteur_manager'::text, 'traiteur_commercial'::text, 'agence'::text, 'gestionnaire_lieux'::text]))
    AND organisation_id = ((auth.jwt() ->> 'organisation_id'::text)::uuid);

GRANT SELECT ON plateforme.v_factures_client TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON plateforme.v_factures_client TO service_role;

--    v_ops_factures_bloquees : intention préservée -> en_attente_pennylane (cf. en-tête).
CREATE VIEW plateforme.v_ops_factures_bloquees
  WITH (security_invoker = true) AS
  SELECT f.id            AS facture_id,
         f.numero_facture,
         f.organisation_id,
         f.statut,
         f.created_at,
         EXTRACT(EPOCH FROM (now() - f.updated_at)) / 3600 AS heures_sans_retour
  FROM plateforme.factures f
  WHERE f.statut = 'en_attente_pennylane'
    AND f.updated_at < (now() - INTERVAL '48 hours')
  ORDER BY f.updated_at;

GRANT SELECT, INSERT, UPDATE, DELETE ON plateforme.v_ops_factures_bloquees TO service_role;

--    v_kpi_admin : corps verbatim (pg_get_viewdef), seule substitution emise/payee::facture_statut.
CREATE VIEW plateforme.v_kpi_admin
  WITH (security_invoker = true) AS
 WITH collectes_agg AS (
         SELECT date_trunc('month'::text, c.date_collecte::timestamp with time zone)::date AS mois,
            c.type::text AS type_collecte,
            count(c.id) AS nb_collectes,
            count(
                CASE
                    WHEN c.statut = 'cloturee'::plateforme.collecte_statut THEN 1
                    ELSE NULL::integer
                END) AS nb_cloturees
           FROM plateforme.collectes c
          WHERE c.statut <> ALL (ARRAY['annulee'::plateforme.collecte_statut, 'brouillon'::plateforme.collecte_statut])
          GROUP BY (date_trunc('month'::text, c.date_collecte::timestamp with time zone)), c.type
        ), revenus_directs AS (
         SELECT date_trunc('month'::text, f.date_emission::timestamp with time zone)::date AS mois,
                CASE
                    WHEN f.type = 'zero_dechet'::plateforme.facture_type THEN 'zero_dechet'::text
                    WHEN f.type = ANY (ARRAY['collecte_antigaspi'::plateforme.facture_type, 'achat_pack_antigaspi'::plateforme.facture_type]) THEN 'anti_gaspi'::text
                    ELSE NULL::text
                END AS type_collecte,
            sum(f.montant_ht) AS montant_ht
           FROM plateforme.factures f
          WHERE (f.statut = ANY (ARRAY['emise'::plateforme.facture_statut, 'payee'::plateforme.facture_statut])) AND f.date_emission IS NOT NULL AND f.type <> 'avoir'::plateforme.facture_type
          GROUP BY (date_trunc('month'::text, f.date_emission::timestamp with time zone)), f.type
        ), avoirs AS (
         SELECT date_trunc('month'::text, f.date_emission::timestamp with time zone)::date AS mois,
                CASE
                    WHEN f_orig.type = 'zero_dechet'::plateforme.facture_type THEN 'zero_dechet'::text
                    WHEN f_orig.type = ANY (ARRAY['collecte_antigaspi'::plateforme.facture_type, 'achat_pack_antigaspi'::plateforme.facture_type]) THEN 'anti_gaspi'::text
                    ELSE NULL::text
                END AS type_collecte,
            sum(- f.montant_ht) AS montant_ht
           FROM plateforme.factures f
             JOIN plateforme.factures f_orig ON f_orig.id = f.facture_origine_id
          WHERE (f.statut = ANY (ARRAY['emise'::plateforme.facture_statut, 'payee'::plateforme.facture_statut])) AND f.date_emission IS NOT NULL AND f.type = 'avoir'::plateforme.facture_type
          GROUP BY (date_trunc('month'::text, f.date_emission::timestamp with time zone)), (
                CASE
                    WHEN f_orig.type = 'zero_dechet'::plateforme.facture_type THEN 'zero_dechet'::text
                    WHEN f_orig.type = ANY (ARRAY['collecte_antigaspi'::plateforme.facture_type, 'achat_pack_antigaspi'::plateforme.facture_type]) THEN 'anti_gaspi'::text
                    ELSE NULL::text
                END)
        ), revenus_agg AS (
         SELECT combined.mois,
            combined.type_collecte,
            sum(combined.montant_ht) AS montant_ht
           FROM ( SELECT revenus_directs.mois,
                    revenus_directs.type_collecte,
                    revenus_directs.montant_ht
                   FROM revenus_directs
                UNION ALL
                 SELECT avoirs.mois,
                    avoirs.type_collecte,
                    avoirs.montant_ht
                   FROM avoirs
                  WHERE avoirs.type_collecte IS NOT NULL) combined
          GROUP BY combined.mois, combined.type_collecte
        )
 SELECT COALESCE(ca.mois, ra.mois) AS mois,
    COALESCE(ca.type_collecte, ra.type_collecte) AS type_collecte,
    COALESCE(ca.nb_collectes, 0::bigint) AS nb_collectes,
    COALESCE(ca.nb_cloturees, 0::bigint) AS nb_cloturees,
    COALESCE(ra.montant_ht, 0::numeric) AS montant_factures_ht
   FROM collectes_agg ca
     FULL JOIN revenus_agg ra ON ra.mois = ca.mois AND ra.type_collecte = ca.type_collecte;

GRANT SELECT, INSERT, UPDATE, DELETE ON plateforme.v_kpi_admin TO service_role;

--    v_kpi_traiteur : corps verbatim (pg_get_viewdef), seule substitution emise/payee::facture_statut.
CREATE VIEW plateforme.v_kpi_traiteur
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
            e.id AS evenement_id,
            e.pax,
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
        ), pax_par_type AS (
         SELECT x.organisation_id,
            x.mois,
            x.type_collecte,
            sum(x.pax) AS pax_total
           FROM ( SELECT DISTINCT ON (base.organisation_id, base.mois, base.type_collecte, base.evenement_id) base.organisation_id,
                    base.mois,
                    base.type_collecte,
                    base.evenement_id,
                    base.pax
                   FROM base) x
          GROUP BY x.organisation_id, x.mois, x.type_collecte
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
            sum(b.energie_primaire_evitee_kwh) AS energie_primaire_evitee_kwh
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
            WHEN a.type_collecte = 'zero_dechet'::plateforme.collecte_type AND COALESCE(ppt.pax_total, 0::bigint) > 0 THEN o.tarif_refacture_pax_zd * ppt.pax_total::numeric - COALESCE(fzd.montant_ht, 0::numeric)
            ELSE NULL::numeric
        END AS marge_zd_ht,
    COALESCE(ppt.pax_total, 0::bigint) AS pax_total
   FROM agg a
     JOIN plateforme.organisations o ON o.id = a.organisation_id
     LEFT JOIN pax_par_type ppt ON ppt.organisation_id = a.organisation_id AND ppt.mois = a.mois AND ppt.type_collecte = a.type_collecte
     LEFT JOIN factures_zd fzd ON fzd.organisation_id = a.organisation_id AND fzd.mois = a.mois;

GRANT SELECT ON plateforme.v_kpi_traiteur TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON plateforme.v_kpi_traiteur TO service_role;

-- 7) Recréer le trigger droppé (def verbatim ; fonction inchangée, ne cast pas le type).
CREATE TRIGGER trg_avoir_annule_origine
  AFTER UPDATE OF statut ON plateforme.factures
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_trg_avoir_annule_origine();

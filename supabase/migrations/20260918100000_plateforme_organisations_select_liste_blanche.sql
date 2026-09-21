-- =============================================================================
-- organisations : SELECT en liste blanche colonne-level + garde UPDATE gestionnaire
-- =============================================================================
-- Fuite mesurée (reviewer-rls-securite, PR #357, base locale, rôle authenticated +
-- claims gestionnaire_lieux) : `authenticated` porte le SELECT TABLE-LEVEL sur
-- plateforme.organisations (blanket grant 0.4a). La policy
-- `org_gestionnaire_traiteur_select` (M3.2 — traiteurs intervenus sur les lieux du
-- gestionnaire) ouvre donc TOUTES les colonnes de ces traiteurs par PostgREST direct,
-- dont `notes_internes`, `tarif_refacture_pax_zd` et `grille_tarifaire_zd_id`.
-- CDC §06.05 §5 « Détail traiteur » : « Pas d'accès aux tarifs, pas d'accès aux
-- marges » ; §06.05 §6 : notes internes = « champ Admin uniquement » ; §04 :
-- notes_internes = « non visible par le client ». Même fuite pour l'agence sur les
-- fiches shadow qu'elle a créées (org_agence_select).
--
-- La RLS filtre les LIGNES, jamais les colonnes. Même pattern que M3.1 (UPDATE) et
-- 20260915100000 (INSERT) : on retire le privilège TABLE-LEVEL puis on re-GRANT sur une
-- liste blanche. Un REVOKE colonne seul serait INOPÉRANT tant que le privilège table
-- subsiste. Fail-closed : une colonne ajoutée demain n'est pas lisible par défaut
-- (cf. piège « colonne masquée par GRANT colonne-level » : l'ajouter à la liste
-- ET l'épingler dans SECU__organisations_select_liste_blanche.test.sql).
--
-- Colonnes RETIRÉES à authenticated (staff-only, lues en service_role) :
--   notes_internes, grille_tarifaire_zd_id, mode_facturation_zd, tarif_refacture_pax_zd.
-- Lecteurs recensés (grep exhaustif packages/ + vues + fonctions, 2026-09-18) :
--   - notes_internes / grille_tarifaire_zd_id / mode_facturation_zd : uniquement des
--     chemins service_role (admin/organisations, tarif-zd via recap-email et batch
--     brouillons J+1). Aucun lecteur authenticated.
--   - tarif_refacture_pax_zd : 2 lecteurs authenticated LÉGITIMES (§04 : « lecture
--     traiteur ») — (a) la vue v_kpi_traiteur (security_invoker, colonne marge_zd_ht)
--     et (b) loaders.ts (tooltip du KPI Marge, sa propre organisation). Un privilège
--     colonne ne sait pas distinguer « ma ligne » de « la ligne d'un autre » : la
--     lecture passe désormais par f_tarif_refacture_pax_zd(org), SECURITY DEFINER,
--     qui ne rend la valeur qu'au traiteur propriétaire (manager/commercial) et au
--     staff. Effet de bord voulu : v_kpi_traiteur ne dérive plus la marge d'un
--     traiteur pour un gestionnaire ou une agence (marge_zd_ht = NULL pour eux).
--
-- Deuxième point (même table) : le GRANT UPDATE colonne-level de M3.1 couvre nom,
-- raison_sociale, siret, email_principal, telephone pour TOUS les rôles porteurs d'une
-- policy UPDATE. Le traiteur_manager en a besoin (route profil : raison_sociale, siret),
-- pas le gestionnaire (§06.05 §6 : nom en lecture seule, adresse et logo modifiables ;
-- route gestionnaire : EDITABLE_FIELDS = adresse, logo_url). Le privilège étant
-- par rôle PG et non par rôle métier, la garde est un trigger BEFORE UPDATE en liste
-- blanche (fail-closed : toute autre colonne modifiée par un gestionnaire → 42501).
--
-- NON DESTRUCTIF : aucune donnée touchée, aucune colonne supprimée ou renommée.
-- FERME des accès (CLAUDE.md §12-2bis) — MAIS crée une fonction SECURITY DEFINER
-- exécutable par authenticated (nécessaire : v_kpi_traiteur est security_invoker) :
-- GO sécurité + décision Val requis avant application prod.
-- =============================================================================

-- ─── 1. SELECT : table-level retiré, liste blanche colonne-level ─────────────
REVOKE SELECT ON plateforme.organisations FROM authenticated;

GRANT SELECT (
  id,
  nom,
  raison_sociale,
  type,
  email_principal,
  telephone,
  adresse,
  siret,
  logo_url,
  actif,
  est_shadow,
  cree_par_organisation_id,
  created_at,
  updated_at
) ON plateforme.organisations TO authenticated;

-- ─── 2. Lecture gardée du tarif refacturé (propriétaire + staff) ─────────────
CREATE OR REPLACE FUNCTION plateforme.f_tarif_refacture_pax_zd(p_organisation_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
  SELECT o.tarif_refacture_pax_zd
    FROM plateforme.organisations o
   WHERE o.id = p_organisation_id
     AND (
       plateforme.f_app_role() IN ('admin_savr', 'ops_savr')
       OR (
         plateforme.f_app_role() IN ('traiteur_manager', 'traiteur_commercial')
         AND o.id = (auth.jwt()->>'organisation_id')::uuid
       )
     )
$$;

REVOKE ALL ON FUNCTION plateforme.f_tarif_refacture_pax_zd(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION plateforme.f_tarif_refacture_pax_zd(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION plateforme.f_tarif_refacture_pax_zd(uuid) IS
  'Tarif refacturé €/pax ZD d''une organisation, rendu au seul traiteur propriétaire (manager/commercial) et au staff (admin_savr/ops_savr) identifiés par le claim JWT user_role ; NULL sinon. ⚠ service_role SANS claims (createAdminSupabaseClient) obtient NULL : un job staff doit lire la colonne directement (privilège service_role intact), pas cette fonction ni v_kpi_traiteur.marge_zd_ht. Seul chemin de lecture authenticated depuis 20260918100000 (colonne retirée du GRANT SELECT). Utilisée par v_kpi_traiteur (security_invoker) et le tooltip du KPI Marge.';

COMMENT ON COLUMN plateforme.organisations.tarif_refacture_pax_zd IS
  'Tarif refacturé €/pax ZD (KPI Marge dashboard traiteur). Défaut 1.50. Écriture Admin Savr only (M3.1). Lecture authenticated uniquement via f_tarif_refacture_pax_zd() (20260918100000 : colonne hors GRANT SELECT).';

COMMENT ON COLUMN plateforme.organisations.notes_internes IS
  'Commentaires Admin Savr, jamais visibles par un client (§04, §06.05 §6). Hors GRANT SELECT authenticated depuis 20260918100000 : lecture service_role uniquement.';

-- ─── 3. v_kpi_traiteur : la marge lit le tarif par la fonction gardée ────────
-- Corps verbatim de 20260623130000 ; seule substitution : o.tarif_refacture_pax_zd
-- → plateforme.f_tarif_refacture_pax_zd(o.id). Colonnes et types inchangés.
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
            WHEN a.type_collecte = 'zero_dechet'::plateforme.collecte_type AND COALESCE(ppt.pax_total, 0::bigint) > 0 THEN plateforme.f_tarif_refacture_pax_zd(o.id) * ppt.pax_total::numeric - COALESCE(fzd.montant_ht, 0::numeric)
            ELSE NULL::numeric
        END AS marge_zd_ht,
    COALESCE(ppt.pax_total, 0::bigint) AS pax_total
   FROM agg a
     JOIN plateforme.organisations o ON o.id = a.organisation_id
     LEFT JOIN pax_par_type ppt ON ppt.organisation_id = a.organisation_id AND ppt.mois = a.mois AND ppt.type_collecte = a.type_collecte
     LEFT JOIN factures_zd fzd ON fzd.organisation_id = a.organisation_id AND fzd.mois = a.mois;

-- ─── 4. UPDATE gestionnaire_lieux : liste blanche adresse / logo_url ─────────
-- updated_at n'est PAS dans la liste : aucun trigger ne le pose et la route
-- gestionnaire ne l'écrit pas ; l'y laisser permettait de forger l'horodatage.
CREATE OR REPLACE FUNCTION plateforme.fn_block_org_gestionnaire_cols_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  IF plateforme.f_app_role() = 'gestionnaire_lieux'
     AND (to_jsonb(NEW) - ARRAY['adresse', 'logo_url'])
         IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['adresse', 'logo_url'])
  THEN
    RAISE EXCEPTION 'gestionnaire_lieux : seules l''adresse et le logo de l''organisation sont modifiables (§06.05 §6)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION plateforme.fn_block_org_gestionnaire_cols_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_block_org_gestionnaire_cols_update ON plateforme.organisations;
CREATE TRIGGER trg_block_org_gestionnaire_cols_update
  BEFORE UPDATE ON plateforme.organisations
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_block_org_gestionnaire_cols_update();

COMMENT ON TRIGGER trg_block_org_gestionnaire_cols_update ON plateforme.organisations IS
  'Liste blanche UPDATE du gestionnaire_lieux sur SA propre organisation : adresse, logo_url (§06.05 §6, nom en lecture seule). Le GRANT UPDATE colonne-level de M3.1 est commun à tous les rôles PG authenticated (le traiteur_manager édite raison_sociale et siret) : il ne peut pas porter cette restriction par rôle métier.';

-- ROLLBACK (rouvre des accès : décision explicite de Val, CLAUDE.md §12-2bis) :
-- supprimer le trigger et sa fonction ; restaurer v_kpi_traiteur (lecture directe de
-- la colonne) ; supprimer f_tarif_refacture_pax_zd ; ré-accorder SELECT au niveau table
-- à authenticated puis retirer le grant colonne devenu sans objet.

-- Benchmark : les filtres Lieux / Traiteurs du gestionnaire de lieux sont bornés à
-- son périmètre (§06.05 Bloc 3 ZD, décision Val 2026-10-06, divergence
-- M3.2_20261006_benchmark-filtres-lieux-traiteurs-rattaches).
-- ---------------------------------------------------------------------------
-- RÈGLE. Sans sélection, le repère reste calculé sur tout le parc Savr. Dès qu'il
-- nomme un lieu ou un traiteur, le gestionnaire ne peut nommer que :
--   - un lieu rattaché à son organisation (`organisations_lieux`) ;
--   - un traiteur intervenu sur ses lieux (événement daté), c'est-à-dire exactement
--     ceux que `v_traiteurs_gestionnaire` lui laisse déjà lire
--     (`f_traiteur_intervenu_lieux_gestionnaire`).
-- L'écran propose un sous-ensemble de ce second périmètre (collecte sur ses lieux
-- depuis 24 mois, même liste que le filtre global du dashboard) ; la garde ci-dessous
-- porte la borne de lecture, pas la fenêtre d'affichage.
--
-- AVANT. Les deux fonctions de liste rendaient à un gestionnaire le nom de TOUS les
-- lieux actifs du parc et de TOUS les traiteurs actifs du parc, et
-- `f_benchmark_kg_pax_zd` calculait un segment sur n'importe quel lieu ou traiteur
-- nommé. Le schéma `plateforme` étant servi par PostgREST, ces trois fonctions se
-- joignent aussi sans passer par les routes de l'application.
--
-- CETTE MIGRATION FERME, ELLE N'OUVRE RIEN (CLAUDE.md §12 2bis) :
--   1. `f_benchmark_lieux_parc`     : `gestionnaire_lieux` sort de la liste blanche ;
--   2. `f_benchmark_traiteurs_parc` : idem (restent `admin_savr`, `ops_savr`) ;
--   3. `f_benchmark_kg_pax_zd`      : garde de périmètre pour `gestionnaire_lieux`,
--      SQLSTATE 42501, levée avant toute lecture de collecte.
-- Le gestionnaire n'a plus besoin des listes « parc » : ses options viennent de
-- `organisations_lieux` et de `v_traiteurs_gestionnaire`, lues sous sa propre session
-- (`loadFiltresParcGestionnaire`, même code que le filtre global).
--
-- CE QUI NE CHANGE PAS : les rôles traiteur et agence (liste des lieux du parc, garde
-- compétitive sur `p_traiteur_ids`), le staff, le k-anonymat, la formule, les 7
-- paramètres et les colonnes de sortie. Un appel sans rôle gestionnaire ne traverse
-- pas la nouvelle garde : rafraîchissement de `mv_benchmark_kg_pax_zd_base`,
-- `f_rapport_benchmark_zd` (PDF, service_role) et `f_benchmark_single_collecte`, qui
-- ne passe ni lieu ni traiteur.
--
-- `CREATE OR REPLACE` préserve l'ACL et remet `proconfig` à zéro : `SECURITY DEFINER`
-- et `SET search_path = plateforme, pg_catalog` sont donc reconduits mot pour mot, et
-- aucun privilège n'est reposé ici. Les corps sont recopiés de 20260930180000
-- (lieux), 20260923090000 (traiteurs) et 20260922210000 (calcul) : seules changent
-- les deux listes blanches et l'ajout du bloc de garde.
--
-- ROLLBACK : rejouer les trois fonctions depuis les migrations citées ci-dessus.
-- ---------------------------------------------------------------------------

BEGIN;

-- ─── 1. f_benchmark_lieux_parc ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.f_benchmark_lieux_parc()
RETURNS TABLE (id uuid, nom text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
BEGIN
  IF plateforme.f_app_role() IS NULL THEN
    RAISE EXCEPTION 'Role applicatif absent (acces refuse)';
  END IF;
  IF plateforme.f_app_role() NOT IN
     ('traiteur_manager', 'traiteur_commercial', 'agence',
      'admin_savr', 'ops_savr') THEN
    RAISE EXCEPTION 'Role non autorise pour la liste benchmark';
  END IF;
  RETURN QUERY
  SELECT l.id, l.nom
  FROM plateforme.lieux l
  WHERE l.actif IS DISTINCT FROM false
  ORDER BY l.nom;
END $$;

COMMENT ON FUNCTION plateforme.f_benchmark_lieux_parc() IS
  'Liste id+nom des lieux du parc Savr pour le filtre benchmark (§06.04, §06.11). SECURITY DEFINER, garde role fail-closed. Roles traiteur, agence et staff ; gestionnaire_lieux retire le 2026-10-06 (ses lieux viennent de organisations_lieux).';

-- ─── 2. f_benchmark_traiteurs_parc ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.f_benchmark_traiteurs_parc()
RETURNS TABLE (id uuid, nom text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
BEGIN
  IF plateforme.f_app_role() IS NULL THEN
    RAISE EXCEPTION 'Role applicatif absent (acces refuse)';
  END IF;
  IF plateforme.f_app_role() NOT IN ('admin_savr', 'ops_savr') THEN
    RAISE EXCEPTION 'Role non autorise pour la liste traiteurs benchmark';
  END IF;
  RETURN QUERY
  SELECT o.id, COALESCE(o.nom, o.raison_sociale) AS nom
  FROM plateforme.organisations o
  WHERE o.type = 'traiteur'
    AND o.actif IS DISTINCT FROM false
    AND o.est_shadow IS DISTINCT FROM true
  ORDER BY 2;
END $$;

COMMENT ON FUNCTION plateforme.f_benchmark_traiteurs_parc() IS
  'Liste id+nom des traiteurs du parc Savr pour le Dashboard Client Admin. SECURITY DEFINER, garde role fail-closed. Staff seul : roles traiteur et agence exclus (competitif), gestionnaire_lieux retire le 2026-10-06 (ses traiteurs viennent de v_traiteurs_gestionnaire).';

-- ─── 3. f_benchmark_kg_pax_zd ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.f_benchmark_kg_pax_zd(
  p_flux_id                 uuid   DEFAULT NULL,
  p_type_evenement_ids      uuid[] DEFAULT NULL,
  p_taille_evenement_codes  text[] DEFAULT NULL,
  p_periode_debut           date   DEFAULT NULL,
  p_periode_fin             date   DEFAULT NULL,
  p_lieu_ids                uuid[] DEFAULT NULL,
  p_traiteur_ids            uuid[] DEFAULT NULL
) RETURNS TABLE (
  flux_id                     uuid,
  flux_code                   text,
  type_evenement_id           uuid,
  taille_evenement            text,
  kg_par_pax_moyen            numeric,
  nb_collectes_segment        integer,
  nb_organisations_distinctes integer
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
DECLARE
  v_org uuid;
BEGIN
  -- Garde compétitive (§04) : un rôle traiteur ne peut cibler des traiteurs nommés
  -- (sinon il déduirait la performance individuelle d'un concurrent).
  IF plateforme.f_app_role() IN ('traiteur_manager', 'traiteur_commercial')
     AND p_traiteur_ids IS NOT NULL
     AND array_length(p_traiteur_ids, 1) > 0 THEN
    RAISE EXCEPTION
      'Filtre traiteur_ids interdit pour le role traiteur (preservation competitive)';
  END IF;

  -- Garde de périmètre (§06.05, décision Val 2026-10-06) : un gestionnaire ne nomme
  -- que ses lieux rattachés et les traiteurs intervenus sur ses lieux. Un tableau
  -- NULL ou vide ne nomme rien (unnest rend 0 ligne) : le repère « tout le parc »
  -- reste ouvert. Un élément NULL, ou un jeton sans organisation, est refusé.
  IF plateforme.f_app_role() = 'gestionnaire_lieux' THEN
    v_org := (auth.jwt()->>'organisation_id')::uuid;
    IF EXISTS (
      SELECT 1
      FROM unnest(p_lieu_ids) AS demande(lieu_demande)
      WHERE NOT EXISTS (
        SELECT 1
        FROM plateforme.organisations_lieux ol
        WHERE ol.lieu_id = demande.lieu_demande
          AND ol.organisation_id = v_org)
    ) THEN
      RAISE EXCEPTION 'Filtre lieu_ids hors des lieux rattaches au gestionnaire'
        USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM unnest(p_traiteur_ids) AS demande(traiteur_demande)
      WHERE plateforme.f_traiteur_intervenu_lieux_gestionnaire(
              demande.traiteur_demande) IS NOT TRUE
    ) THEN
      RAISE EXCEPTION
        'Filtre traiteur_ids hors des traiteurs intervenus sur les lieux du gestionnaire'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Grain de sortie CDC §04 « Colonnes exposées » : un tuple par
  -- (flux × type d'événement × taille). Les paramètres p_* sont des FILTRES.
  RETURN QUERY
  SELECT
    fd.id,
    fd.code,
    e.type_evenement_id,
    plateforme.taille_evenement_bracket(e.pax) AS taille_evenement,
    -- Moyenne pondérée par tonnage : Σ poids du flux / Σ pax du segment
    -- (collectes plus lourdes pèsent proportionnellement plus — §04 Data Model).
    (SUM(cf.poids_reel_kg) / NULLIF(SUM(e.pax), 0))::numeric AS kg_par_pax_moyen,
    COUNT(DISTINCT c.id)::integer AS nb_collectes_segment,
    -- Organisations programmatrices du segment. Depuis le durcissement 2026-09-22,
    -- c'est une GARDE (cf. HAVING), plus seulement une colonne d'audit.
    COUNT(DISTINCT e.organisation_id)::integer AS nb_organisations_distinctes
  FROM plateforme.collectes c
  JOIN plateforme.evenements e     ON e.id = c.evenement_id
  JOIN plateforme.collecte_flux cf ON cf.collecte_id = c.id
  JOIN plateforme.flux_dechets fd  ON fd.id = cf.flux_id
  WHERE c.statut = 'cloturee'
    AND c.type = 'zero_dechet'
    AND cf.poids_reel_kg IS NOT NULL
    AND (p_flux_id IS NULL OR fd.id = p_flux_id)
    AND (p_type_evenement_ids IS NULL
         OR e.type_evenement_id = ANY (p_type_evenement_ids))
    AND (p_taille_evenement_codes IS NULL
         OR plateforme.taille_evenement_bracket(e.pax) = ANY (p_taille_evenement_codes))
    AND (p_periode_debut IS NULL OR c.date_collecte >= p_periode_debut)
    AND (p_periode_fin   IS NULL OR c.date_collecte <= p_periode_fin)
    AND (p_lieu_ids IS NULL OR e.lieu_id = ANY (p_lieu_ids))
    AND (p_traiteur_ids IS NULL
         OR e.traiteur_operationnel_organisation_id = ANY (p_traiteur_ids))
  GROUP BY fd.id, fd.code, e.type_evenement_id, taille_evenement
  -- k-anonymat (§04, durci 2026-09-22) : segment masqué s'il porte moins de 5 collectes
  -- OU moins de 3 acteurs distincts, de part ET d'autre (programmateur / opérationnel).
  HAVING COUNT(DISTINCT c.id) >= 5
     AND COUNT(DISTINCT e.organisation_id) >= 3
     AND COUNT(DISTINCT e.traiteur_operationnel_organisation_id) >= 3;
END $$;

COMMENT ON FUNCTION plateforme.f_benchmark_kg_pax_zd(uuid, uuid[], text[], date, date, uuid[], uuid[]) IS
  'Benchmark parc kg/pax ZD — grain (flux x type_evenement x taille), moyenne ponderee par tonnage (SUM poids / SUM pax), 7 filtres CDC 04/11. k-anonymat DOUBLE (durci 2026-09-22) : >=5 collectes ET >=3 acteurs distincts sur les deux colonnes (organisation programmatrice ET traiteur operationnel). SECURITY DEFINER + garde competitive role traiteur + garde de perimetre gestionnaire_lieux (2026-10-06 : lieux rattaches et traiteurs intervenus seulement, SQLSTATE 42501).';

COMMIT;

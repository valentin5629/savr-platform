-- Benchmark : les filtres Lieux / Traiteurs du gestionnaire de lieux sont bornés à
-- son périmètre (§06.05 Bloc 3 ZD, décision Val 2026-10-06, divergence
-- M3.2_20261006_benchmark-filtres-lieux-traiteurs-rattaches).
-- ---------------------------------------------------------------------------
-- RÈGLE. Sans sélection, le repère reste calculé sur tout le parc Savr. Dès qu'il
-- nomme un lieu ou un traiteur dans le calcul, le gestionnaire ne peut nommer que :
--   - un lieu rattaché à son organisation (`organisations_lieux`) ;
--   - un traiteur que la vue `v_traiteurs_gestionnaire` lui rend : organisation de
--     type traiteur, opérationnelle sur un événement daté tenu sur l'un de ses
--     lieux. La garde lit la vue elle-même, pas une copie de son prédicat.
-- L'écran propose un sous-ensemble de ce second périmètre (collecte sur ses lieux
-- depuis 24 mois, même liste que le filtre global du dashboard) ; la garde porte
-- la borne de la vue, pas la fenêtre d'affichage.
--
-- AVANT. Les deux fonctions de liste rendaient à un gestionnaire le nom de tous les
-- lieux actifs du parc et de tous les traiteurs actifs du parc, et
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
-- (`loadFiltresParcGestionnaire`, même code que le filtre global). Après ce lot,
-- plus aucun code de l'application n'appelle `f_benchmark_traiteurs_parc` (le
-- Dashboard Client Admin lit ses listes par ses propres requêtes) : elle reste en
-- place, réduite au staff.
--
-- CE QUE CETTE MIGRATION NE FERME PAS. Le nom des traiteurs actifs du parc reste
-- lisible par un gestionnaire dans `v_referentiel_traiteurs` (id + libellé, servis
-- à tout rôle client) : ce qui est fermé ici, c'est la liste servie par la fonction
-- benchmark et le fait de les nommer dans le calcul. Et la borne « intervenu sur ses
-- lieux » suit les événements datés : un gestionnaire qui programme lui-même un
-- événement daté sur son lieu avec un traiteur le fait entrer dans son périmètre.
--
-- CE QUI NE CHANGE PAS : les rôles traiteur et agence (liste des lieux du parc), la
-- garde compétitive sur `p_traiteur_ids` (elle vise `traiteur_manager` et
-- `traiteur_commercial`, pas `agence` : dette connue, hors de ce lot), le staff, le
-- k-anonymat, la formule, les 7 paramètres et les colonnes de sortie. La nouvelle
-- garde ne vise que `gestionnaire_lieux` : tout autre appelant nomme lieux et
-- traiteurs comme avant. Le rafraîchissement de `mv_benchmark_kg_pax_zd_base` et
-- `f_rapport_benchmark_zd` (PDF, service_role) tournent sans rôle gestionnaire et
-- n'entrent donc pas dans la garde. `f_benchmark_single_collecte`, elle, appelle le
-- calcul sous le jeton de l'appelant : pour un gestionnaire elle entre dans la garde
-- et la passe, parce qu'elle ne nomme ni lieu ni traiteur.
--
-- `CREATE OR REPLACE` préserve l'ACL et remet `proconfig` à zéro : `SECURITY DEFINER`
-- et `SET search_path = plateforme, pg_catalog` sont donc reconduits mot pour mot, et
-- aucun privilège n'est reposé ici. Les corps sont recopiés de 20260930180000
-- (lieux), 20260923090000 (traiteurs) et 20260922210000 (calcul) : seules changent
-- les deux listes blanches et l'ajout du bloc de garde.
--
-- ROLLBACK : rejouer les trois fonctions depuis les migrations citées ci-dessus.
-- ⚠ Ce rejeu ROUVRE au gestionnaire les deux listes du parc et le filtre sur
-- n'importe quel lieu ou traiteur : c'est une migration qui élargit un accès, donc
-- un arbitrage de Val (CLAUDE.md §12 2bis), pas un geste technique.
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
  -- Fail-closed : sans ce test, NULL NOT IN (…) vaut NULL et un jeton sans rôle
  -- métier obtenait la liste complète des traiteurs concurrents.
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
  'Liste id+nom des traiteurs du parc Savr (valeurs du filtre benchmark). SECURITY DEFINER, garde role fail-closed. Staff seul : roles traiteur et agence exclus (competitif), gestionnaire_lieux retire le 2026-10-06 (ses traiteurs viennent de v_traiteurs_gestionnaire).';

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
  -- que ses lieux rattachés et les traiteurs que `v_traiteurs_gestionnaire` lui
  -- rend. Un tableau NULL ou vide ne nomme rien et passe la garde : NULL laisse le
  -- repère sur tout le parc ; vide ne rend aucun segment, comme avant
  -- (`= ANY('{}')`). Un élément NULL est refusé. Un jeton sans organisation
  -- (absente ou vide) est refusé dès qu'il nomme un lieu ou un traiteur ; s'il ne
  -- nomme rien, il reçoit le repère « tout le parc », comme avant.
  -- Les deux messages commencent par « Filtre lieu_ids hors » / « Filtre
  -- traiteur_ids hors » : `loadBenchmark` les reconnaît à ce début pour rendre un
  -- 403 (tout autre 42501, droit d'exécution retiré par exemple, reste un 500).
  IF plateforme.f_app_role() = 'gestionnaire_lieux' THEN
    v_org := NULLIF(auth.jwt()->>'organisation_id', '')::uuid;
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
    IF cardinality(p_traiteur_ids) > 0 THEN
      -- Sans organisation, la vue ne peut rien rendre : refus posé d'abord, dans
      -- un IF séquentiel, pour ne jamais l'évaluer avec un jeton incomplet.
      IF v_org IS NULL THEN
        RAISE EXCEPTION
          'Filtre traiteur_ids hors des traiteurs intervenus sur les lieux du gestionnaire'
          USING ERRCODE = '42501';
      ELSIF EXISTS (
        SELECT 1
        FROM unnest(p_traiteur_ids) AS demande(traiteur_demande)
        WHERE NOT EXISTS (
          SELECT 1
          FROM plateforme.v_traiteurs_gestionnaire t
          WHERE t.id = demande.traiteur_demande)
      ) THEN
        RAISE EXCEPTION
          'Filtre traiteur_ids hors des traiteurs intervenus sur les lieux du gestionnaire'
          USING ERRCODE = '42501';
      END IF;
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
  'Benchmark parc kg/pax ZD — grain (flux x type_evenement x taille), moyenne ponderee par tonnage (SUM poids / SUM pax), 7 filtres CDC 04/11. k-anonymat DOUBLE (durci 2026-09-22) : >=5 collectes ET >=3 acteurs distincts sur les deux colonnes (organisation programmatrice ET traiteur operationnel) — 5 collectes d''un acteur unique publiaient sa performance individuelle. SECURITY DEFINER + garde competitive role traiteur + garde de perimetre gestionnaire_lieux (2026-10-06 : lieux rattaches et traiteurs de v_traiteurs_gestionnaire seulement, SQLSTATE 42501).';

COMMIT;

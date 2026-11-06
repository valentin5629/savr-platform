-- =============================================================================
-- Garde compétitive de f_benchmark_kg_pax_zd étendue à l'agence et au client
-- organisateur (revue sécurité, suite de la PR #686)
-- =============================================================================
-- CONSTAT. La garde compétitive (§04 « préservation compétitive ») refuse
-- `p_traiteur_ids` non vide aux seuls rôles `traiteur_manager` et
-- `traiteur_commercial`. L'agence et le client organisateur (qui affiche le
-- radar de la fiche Événement depuis la PR #686, décision Val 2026-10-30)
-- n'étaient arrêtés que côté serveur, par `loadBenchmark`. Or la fonction est
-- `GRANT EXECUTE … TO authenticated` : leur session peut l'appeler en direct par
-- PostgREST (`/rest/v1/rpc/f_benchmark_kg_pax_zd`) et nommer des traiteurs. Le
-- k-anonymat (≥ 5 collectes, ≥ 3 acteurs) ne suffit pas : deux appels, l'un sur
-- {A, B, C, D}, l'autre sur {A, B, C}, isolent par différence la contribution
-- du traiteur D.
--
-- CHANGEMENT : la liste des rôles de la garde compétitive passe de
-- ('traiteur_manager', 'traiteur_commercial') à
-- ('traiteur_manager', 'traiteur_commercial', 'agence', 'client_organisateur').
-- Rien d'autre : corps, garde de périmètre du gestionnaire, k-anonymat,
-- signature, colonnes de sortie, `SECURITY DEFINER`, `SET search_path`, message
-- d'erreur et SQLSTATE (P0001) sont recopiés de 20261024120000 mot pour mot.
-- L'Admin et le gestionnaire de lieux (garde de périmètre propre) sont
-- inchangés.
--
-- CETTE MIGRATION FERME UN ACCÈS (CLAUDE.md §12 2bis) : aucun GRANT élargi,
-- aucune policy touchée. REVOKE … FROM PUBLIC et GRANT … TO authenticated sont
-- ré-énoncés à l'identique de 20260705130000 (CREATE OR REPLACE conserve déjà
-- l'ACL ; un GRANT ne retire rien) : l'ensemble des bénéficiaires est inchangé.
-- Preuve : supabase/tests/benchmark_garde_competitive_agence_organisateur.test.sql.
--
-- RESTE OUVERT (non traité ici, à arbitrer par Val) :
--   • même calcul par différence sur `p_lieu_ids` (lieux {L1, L2, L3} puis
--     {L1, L2}) pour tout rôle autre que le gestionnaire de lieux ;
--   • rôle NULL (jeton sans `user_role`) : n'appartient à aucune liste, la garde
--     ne s'arme pas (déjà noté dans 20260923090000).
--
-- ROLLBACK : rejouer le §1 de 20261024120000 (CREATE OR REPLACE du même corps
-- avec l'ancienne liste de deux rôles) et son COMMENT ON. ⚠ Réouvre l'accès.
-- =============================================================================

BEGIN;

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
  -- Garde compétitive (§04) : un rôle traiteur, l'agence ou le client organisateur
  -- ne peut cibler des traiteurs nommés (sinon il déduirait, par différence entre
  -- deux appels, la performance individuelle d'un traiteur).
  IF plateforme.f_app_role() IN ('traiteur_manager', 'traiteur_commercial',
                                 'agence', 'client_organisateur')
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
  -- Type et taille sont ceux de la COLLECTE (lot C1, C3 / C4) : chaque collecte
  -- est rangée et divisée par ses propres convives, jamais par le total de
  -- l'événement.
  RETURN QUERY
  SELECT
    fd.id,
    fd.code,
    c.type_evenement_id,
    plateforme.taille_evenement_bracket(c.pax) AS taille_evenement,
    -- Moyenne pondérée par tonnage : Σ poids du flux / Σ pax du segment
    -- (collectes plus lourdes pèsent proportionnellement plus — §04 Data Model).
    -- `uniq_collecte_flux` (collecte_id, flux_id) : chaque collecte compte son pax
    -- une fois par flux.
    (SUM(cf.poids_reel_kg) / NULLIF(SUM(c.pax), 0))::numeric AS kg_par_pax_moyen,
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
    -- Convives inconnus (0, reprise Bubble) : la collecte sort du parc — poids,
    -- convives et nombre de collectes (décision Val 2026-10-24, Q4).
    AND c.pax > 0
    AND (p_flux_id IS NULL OR fd.id = p_flux_id)
    AND (p_type_evenement_ids IS NULL
         OR c.type_evenement_id = ANY (p_type_evenement_ids))
    AND (p_taille_evenement_codes IS NULL
         OR plateforme.taille_evenement_bracket(c.pax) = ANY (p_taille_evenement_codes))
    AND (p_periode_debut IS NULL OR c.date_collecte >= p_periode_debut)
    AND (p_periode_fin   IS NULL OR c.date_collecte <= p_periode_fin)
    AND (p_lieu_ids IS NULL OR e.lieu_id = ANY (p_lieu_ids))
    AND (p_traiteur_ids IS NULL
         OR e.traiteur_operationnel_organisation_id = ANY (p_traiteur_ids))
  GROUP BY fd.id, fd.code, c.type_evenement_id, taille_evenement
  -- k-anonymat (§04, durci 2026-09-22) : segment masqué s'il porte moins de 5 collectes
  -- OU moins de 3 acteurs distincts, de part ET d'autre (programmateur / opérationnel).
  HAVING COUNT(DISTINCT c.id) >= 5
     AND COUNT(DISTINCT e.organisation_id) >= 3
     AND COUNT(DISTINCT e.traiteur_operationnel_organisation_id) >= 3;
END $$;

COMMENT ON FUNCTION plateforme.f_benchmark_kg_pax_zd(uuid, uuid[], text[], date, date, uuid[], uuid[]) IS
  'Benchmark parc kg/pax ZD — grain (flux x type_evenement x taille), type et taille de la COLLECTE (lot C1 2026-10-24), moyenne ponderee par tonnage (SUM poids / SUM collectes.pax), collecte a pax 0 exclue (Q4 Val 2026-10-24), 7 filtres CDC 04/11. k-anonymat DOUBLE (durci 2026-09-22) : >=5 collectes ET >=3 acteurs distincts sur les deux colonnes (organisation programmatrice ET traiteur operationnel). SECURITY DEFINER + garde competitive roles traiteur, agence et client_organisateur (2026-10-30) + garde de perimetre gestionnaire_lieux (2026-10-06 : lieux rattaches et traiteurs de v_traiteurs_gestionnaire seulement, SQLSTATE 42501).';


REVOKE EXECUTE ON FUNCTION
  plateforme.f_benchmark_kg_pax_zd(uuid, uuid[], text[], date, date, uuid[], uuid[])
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  plateforme.f_benchmark_kg_pax_zd(uuid, uuid[], text[], date, date, uuid[], uuid[])
  TO authenticated;

COMMIT;

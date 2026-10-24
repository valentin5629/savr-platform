-- Cloisonnement des brouillons pour le gestionnaire de lieux (décision Val
-- 2026-10-24, piste « garde sur le statut »).
--
-- Règle (CDC §06.05 décision F3, §09 garde B-2) : un gestionnaire ne lit pas le
-- brouillon d'une autre organisation tenu sur un lieu de son parc. Jusqu'ici la
-- règle était portée par « l'événement a une date » (`date_evenement IS NOT
-- NULL`). Or un brouillon a toujours une date : `collectes.date_collecte` est
-- NOT NULL, une programmation porte au moins une collecte, et
-- `trg_set_date_evenement` calcule `MIN(date_collecte)` sur toutes les
-- collectes non annulées, brouillons compris. La garde de date n'écartait donc
-- aucun brouillon enregistré par le formulaire.
--
-- Correctif : dans le régime « événement d'une autre organisation tenu sur un
-- lieu de mon parc », on exige EN PLUS une collecte hors brouillon. La garde de
-- date reste en place. Chaque changement ajoute une condition : il ne fait que
-- retirer des lignes, n'en ajoute jamais.
--
--   1. f_collecte_visible : la collecte elle-même n'est pas un brouillon.
--   2. evt_gestionnaire_select : l'événement a au moins une collecte hors
--      brouillon. La sous-requête lit `collectes` sous la RLS de la session
--      (col_select) : elle ne trouve que des collectes que le gestionnaire voit
--      déjà, donc elle ne peut pas rendre vrai à partir d'une ligne cachée.
--      Conséquence assumée : un événement d'une autre organisation qui n'a
--      encore aucune collecte (création Admin) n'est plus lu par le gestionnaire
--      du lieu tant qu'aucune collecte n'y est confirmée.
--   3. f_traiteur_intervenu_lieux_gestionnaire (vue v_traiteurs_gestionnaire) :
--      un traiteur n'est « intervenu » sur un lieu du parc que par un événement
--      qui a une collecte hors brouillon.
--   4. f_benchmark_single_collecte : même borne que (1) pour le gestionnaire du
--      lieu ; corps repris de 20261024120000, seule la garde change.
--
-- Inchangés : le régime « événement programmé par mon organisation » (le
-- programmeur voit toujours son brouillon) ; les branches traiteur
-- opérationnel et client organisateur de f_collecte_visible ; la vue
-- v_attributions_gestionnaire, qui garde sa seule garde de date
-- (rpc_valider_attribution_ag, seule fonction SQL qui crée une attribution,
-- exige le statut `programmee`, et la route Admin de modification d'une
-- collecte refuse le retour en brouillon ; la base, elle, ne l'interdit pas).
--
-- Droits : CREATE OR REPLACE FUNCTION et ALTER POLICY conservent propriétaire,
-- droits d'exécution et rôles de la policy ; aucun GRANT n'est ajouté.

-- ─── 1. f_collecte_visible ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.f_collecte_visible(p_collecte_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'plateforme', 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM plateforme.collectes c
    JOIN plateforme.evenements e ON e.id = c.evenement_id
    WHERE c.id = p_collecte_id
      AND (
        plateforme.f_app_role() IN ('admin_savr','ops_savr')
        OR e.organisation_id                         = (auth.jwt()->>'organisation_id')::uuid
        OR e.traiteur_operationnel_organisation_id   = (auth.jwt()->>'organisation_id')::uuid
        OR e.client_organisateur_organisation_id     = (auth.jwt()->>'organisation_id')::uuid
        OR (
          e.date_evenement IS NOT NULL  -- garde anti-fuite brouillons tiers (B-2)
          AND c.statut <> 'brouillon'   -- un brouillon a une date : garde réelle (2026-10-24)
          AND e.lieu_id IN (
            SELECT lieu_id FROM plateforme.organisations_lieux
            WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
          )
        )
      )
  )
$function$;

-- ─── 2. evt_gestionnaire_select ──────────────────────────────────────────────
ALTER POLICY evt_gestionnaire_select ON plateforme.evenements
  USING (
    plateforme.f_app_role() = 'gestionnaire_lieux'
    AND (
      organisation_id = (auth.jwt()->>'organisation_id')::uuid
      OR (
        date_evenement IS NOT NULL
        AND lieu_id IN (
          SELECT organisations_lieux.lieu_id
          FROM plateforme.organisations_lieux
          WHERE organisations_lieux.organisation_id = (auth.jwt()->>'organisation_id')::uuid
        )
        AND EXISTS (
          SELECT 1
          FROM plateforme.collectes c
          WHERE c.evenement_id = evenements.id
            AND c.statut <> 'brouillon'
        )
      )
    )
  );

-- ─── 3. f_traiteur_intervenu_lieux_gestionnaire ──────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.f_traiteur_intervenu_lieux_gestionnaire(p_traiteur_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = plateforme, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM plateforme.evenements e
    JOIN plateforme.organisations_lieux ol ON ol.lieu_id = e.lieu_id
    WHERE e.traiteur_operationnel_organisation_id = p_traiteur_id
      AND ol.organisation_id = (auth.jwt()->>'organisation_id')::uuid
      AND e.date_evenement IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM plateforme.collectes c
        WHERE c.evenement_id = e.id
          AND c.statut <> 'brouillon'
      )
  )
$$;

-- ─── 4. f_benchmark_single_collecte ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.f_benchmark_single_collecte(p_collecte_id uuid)
 RETURNS TABLE(
   flux_code            text,
   taille_evenement     text,
   ratio_user           numeric,
   benchmark_kg_pax     numeric,
   nb_collectes_segment integer
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'plateforme', 'pg_catalog'
AS $function$
DECLARE
  v_role    text := plateforme.f_app_role();
  v_org     uuid := (auth.jwt()->>'organisation_id')::uuid;
  v_evt_org uuid;
  v_evt_top uuid;
  v_pax     integer;
  v_bracket text;
  v_type    uuid;
  v_lieu    uuid;
  v_date    date;
  v_statut  plateforme.collecte_statut;
  -- Gestionnaire dont l'organisation est rattachée au lieu d'un événement daté,
  -- sur une collecte hors brouillon : même borne que f_collecte_visible.
  v_gestionnaire_du_lieu boolean;
BEGIN
  -- Fail-closed : rôle métier absent du jeton ⇒ refus, AVANT toute lecture (ne
  -- pas livrer d'oracle d'existence sur p_collecte_id). `NOT IN` ne peut pas
  -- porter ce cas : NULL NOT IN (…) vaut NULL, donc ne déclenche aucun IF.
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Role applicatif absent (acces refuse)';
  END IF;

  -- Vérification de visibilité (RLS répliquée — fail fast si non accessible).
  -- Pax et type : ceux de la COLLECTE (lot C1, 2026-10-24) ; organisations, lieu
  -- et date restent ceux de l'événement (contrôle d'accès inchangé).
  SELECT e.organisation_id, e.traiteur_operationnel_organisation_id, c.pax, c.type_evenement_id,
         e.lieu_id, e.date_evenement, c.statut
    INTO v_evt_org, v_evt_top, v_pax, v_type, v_lieu, v_date, v_statut
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  WHERE c.id = p_collecte_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collecte not accessible';
  END IF;

  -- admin_savr / ops_savr voient tout le parc : `organisation_id` n'a pour eux
  -- aucun sens et ne doit donc PAS être exigé (un test NULL en bloc, en tête,
  -- les refuserait à tort). Le contrôle d'organisation reste cantonné aux rôles
  -- clients, sous lesquels une organisation absente est désormais un refus
  -- EXPLICITE : `IS DISTINCT FROM` le fermait déjà (il est NULL-safe et rend
  -- TRUE face à NULL), mais l'invariant reposait alors sur cette subtilité au
  -- lieu d'être énoncé — et le message reçu ne disait pas la vraie cause.
  IF v_role NOT IN ('admin_savr', 'ops_savr') THEN
    IF v_org IS NULL THEN
      RAISE EXCEPTION 'Organisation applicative absente (acces refuse)';
    END IF;
    -- Rôle et organisation sont non NULL ici : chaque terme est un booléen
    -- défini, jamais NULL (une garde qui vaudrait NULL ne lèverait pas).
    v_gestionnaire_du_lieu :=
      v_role = 'gestionnaire_lieux'
      AND v_date IS NOT NULL
      AND v_statut <> 'brouillon'
      AND EXISTS (
        SELECT 1
          FROM plateforme.organisations_lieux ol
         WHERE ol.organisation_id = v_org
           AND ol.lieu_id = v_lieu
      );
    IF v_org IS DISTINCT FROM v_evt_org
       AND v_org IS DISTINCT FROM v_evt_top
       AND v_gestionnaire_du_lieu IS NOT TRUE THEN
      RAISE EXCEPTION 'Collecte not accessible';
    END IF;
  END IF;

  v_bracket := plateforme.taille_evenement_bracket(v_pax);

  RETURN QUERY
  WITH valeurs AS (
    -- ratio kg/pax de la collecte courante, par flux (NULL si pax = 0 : convives
    -- inconnus, pas de point « Vous » — Q4 Val 2026-10-24)
    SELECT fd.code AS flux_code,
           cf.poids_reel_kg / NULLIF(v_pax, 0) AS ratio_user
    FROM plateforme.collecte_flux cf
    JOIN plateforme.flux_dechets fd ON fd.id = cf.flux_id
    WHERE cf.collecte_id = p_collecte_id
      AND cf.poids_reel_kg IS NOT NULL
  )
  SELECT
    v.flux_code,
    v_bracket,
    v.ratio_user,
    -- Filtre type + taille de la collecte ⇒ 1 segment par flux (grain CDC flux×type×taille).
    -- b.kg_par_pax_moyen = moyenne pondérée parc, k-anonymat ≥5 appliqué dans
    -- f_benchmark_kg_pax_zd : segment trop petit ⇒ pas de ligne ⇒ NULL ici (le
    -- front masque alors le repère parc, cf. §06.04 « Données insuffisantes »).
    b.kg_par_pax_moyen,
    COALESCE(b.nb_collectes_segment, 0)
  FROM valeurs v
  LEFT JOIN plateforme.f_benchmark_kg_pax_zd(
              p_type_evenement_ids     => ARRAY[v_type],
              p_taille_evenement_codes => ARRAY[v_bracket]) b
         ON b.flux_code = v.flux_code;
END $function$;

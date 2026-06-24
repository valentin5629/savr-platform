-- =============================================================================
-- G9 — RPC-oracles sémantiques (Lot 0 / R0c, controls de 2e ordre red-team).
-- =============================================================================
-- Ferme la fuite L1 : « livrable présent + test vert MAIS règle métier fausse ».
-- Pour chaque règle SI/ALORS à RISQUE, une fonction-oracle `fn_est_*` encode la
-- règle CDC UNE fois, indépendamment de son implémentation (trigger / RPC). Les
-- tests pgTAP (supabase/tests-report/g9_semantic_oracle.test.sql) comparent le
-- comportement RÉEL à l'oracle aux CAS-LIMITES (seuils stricts, bornes) — c'est
-- là que le test « heureux » rate la divergence.
--
-- Règles couvertes (à risque, cf. brief R0c) — référence = DERNIÈRE def en vigueur :
--   1. Débit pack sur annulation tardive AG  (fn_trg_pack_debit_annulation_tardive,
--      dernière def migration 20260623120000) — seuil 12h STRICT, ancrage Europe/Paris.
--   2. Agrégation terminale multi-camions    (fn_agreger_terminal_collecte,
--      logique M1.8 20260615100000, durcie search_path 20260623140000).
--   3. Numérotation gapless facture/bordereau (f_next_numero_facture /
--      f_next_numero_bordereau + sequences_facturation, migrations 20260614160000
--      / 20260615000100).
--
-- Les 3 oracles sont des fonctions PURES (aucune lecture de table) : surface nulle,
-- backward-compat (additif, aucun DROP). SECURITY DEFINER + search_path figé +
-- GRANT service_role, par cohérence avec le pattern des fonctions métier.
--
-- NB cas red-team `heure_collecte NULL` : CONFIRMÉ NON ATTEIGNABLE — la colonne
-- plateforme.collectes.heure_collecte est `time NOT NULL` (migration
-- 20260611171638:126 + DDL cible :659). Le COALESCE(heure_collecte,'00:00') du
-- trigger est du défensif mort. L'oracle reproduit ce COALESCE pour rester
-- fidèle, mais le cas-limite testé est le SEUIL 12h strict, pas le NULL.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Oracle 1 — débit pack attendu sur annulation tardive AG.
-- Reproduit la décision SI/ALORS du trigger : renvoie TRUE ssi un débit effectif
-- de crédit pack doit avoir lieu pour cette transition.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plateforme.fn_est_debit_pack_attendu(
  p_old_statut     text,
  p_new_statut     text,
  p_type           text,
  p_pack_id        uuid,
  p_date_collecte  date,
  p_heure_collecte time,
  p_old_statut_tms text,
  p_now            timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $$
DECLARE
  v_delai_court  boolean;
  v_mandat_actif boolean;
BEGIN
  -- Garde de transition : annulee depuis un statut non-annulee et non-realisee.
  IF p_new_statut <> 'annulee' OR p_old_statut = 'annulee' OR p_old_statut = 'realisee' THEN
    RETURN false;
  END IF;
  IF p_type <> 'anti_gaspi' THEN
    RETURN false;
  END IF;

  -- Condition 1 : < 12h avant la collecte (STRICT), ancrage métier Europe/Paris.
  v_delai_court := (
    ((p_date_collecte + COALESCE(p_heure_collecte, '00:00:00'::time))
       AT TIME ZONE 'Europe/Paris')
    - INTERVAL '12 hours'
  ) < p_now;

  -- Condition 2 : prestataire mandaté (ordre déjà envoyé au TMS).
  v_mandat_actif := (
    p_old_statut_tms IS NOT NULL
    AND p_old_statut_tms NOT IN ('non_envoye', 'a_attribuer')
  );

  IF NOT (v_delai_court OR v_mandat_actif) THEN
    RETURN false; -- annulation en avance sans mandat → pas de débit
  END IF;

  -- Condition tardive remplie mais aucun pack attaché → alerte Admin, PAS de débit.
  IF p_pack_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- -----------------------------------------------------------------------------
-- Oracle 2 — outcome attendu de l'agrégation terminale multi-camions.
-- Reproduit fn_agreger_terminal_collecte : 'pending' | 'realisee' |
-- 'rejetee_par_prestataire' selon (N demandé, N terminé, N annulé).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plateforme.fn_est_terminal_attendu(
  p_nb_demande  integer,
  p_nb_terminee integer,
  p_nb_annulee  integer
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = plateforme, public
AS $$
DECLARE
  v_total integer := COALESCE(p_nb_terminee, 0) + COALESCE(p_nb_annulee, 0);
BEGIN
  -- Tant que tous les tours ne sont pas terminaux → rien à faire.
  IF v_total < COALESCE(p_nb_demande, 0) THEN
    RETURN 'pending';
  END IF;
  -- ≥ 1 tour OK → realisee sur les pesées disponibles.
  IF COALESCE(p_nb_terminee, 0) > 0 THEN
    RETURN 'realisee';
  END IF;
  -- Tous annulés/KO → rejetée par le prestataire.
  RETURN 'rejetee_par_prestataire';
END;
$$;

-- -----------------------------------------------------------------------------
-- Oracle 3 — numérotation gapless. Renvoie TRUE ssi l'ensemble des numéros émis
-- est SANS DOUBLON et CONTIGU (aucun trou interne). Pur (sur un tableau d'entiers)
-- → testable au cas-limite sans dépendre des FK lourdes de `factures`, ET
-- cross-vérifiable contre la sortie réelle de f_next_numero_facture/bordereau.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plateforme.fn_est_numerotation_gapless(
  p_numeros integer[]
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = plateforme, public
AS $$
DECLARE
  v_n        integer;
  v_distinct integer;
  v_min      integer;
  v_max      integer;
BEGIN
  IF p_numeros IS NULL OR array_length(p_numeros, 1) IS NULL THEN
    RETURN true; -- séquence vide = gapless trivialement
  END IF;
  SELECT count(*), count(DISTINCT x), min(x), max(x)
    INTO v_n, v_distinct, v_min, v_max
    FROM unnest(p_numeros) AS x;
  -- Aucun doublon ET contigu (max - min + 1 = nombre d'éléments).
  RETURN v_distinct = v_n AND (v_max - v_min + 1) = v_n;
END;
$$;

-- -----------------------------------------------------------------------------
-- Droits : oracles exécutables via service_role (cohérent avec les fns métier).
-- Les tests pgTAP tournent en superuser (postgres) → GRANT non bloquant pour eux.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION plateforme.fn_est_debit_pack_attendu(text, text, text, uuid, date, time, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION plateforme.fn_est_terminal_attendu(integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION plateforme.fn_est_numerotation_gapless(integer[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION plateforme.fn_est_debit_pack_attendu(text, text, text, uuid, date, time, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION plateforme.fn_est_terminal_attendu(integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION plateforme.fn_est_numerotation_gapless(integer[]) TO service_role;

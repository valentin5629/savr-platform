-- =============================================================================
-- f_dechets_labo_estimes : réservée au gestionnaire de lieux (et au staff)
-- =============================================================================
-- Constat (revue sécurité de la PR #672, 2026-10-29) : la fonction est
-- SECURITY DEFINER, exécutable par `authenticated`, `anon` et PUBLIC, et rend
-- `pax × coefficient` dès que l'événement appartient à l'organisation de
-- l'appelant, quel que soit son rôle. Une agence qui programme pour un
-- traiteur tiers l'appelle en direct, divise par le pax et obtient le
-- coefficient confidentiel du traiteur, alors que `coefficients_perte_labo`
-- lui est fermée. Le CDC §05 R_dechets_labo_estimes réserve la valeur à
-- l'« espace gestionnaire de lieux uniquement ».
--
-- Correctif :
--   1. Garde de rôle dans la fonction : la valeur n'est rendue qu'au staff
--      (qui lit déjà `coefficients_perte_labo` par la policy `cpl_admin`) et au
--      rôle `gestionnaire_lieux`, avec le périmètre inchangé de ce dernier
--      (événement sur un de ses lieux, ou programmé par son organisation).
--      Tout autre rôle reçoit NULL, comme un coefficient non communiqué :
--      aucune erreur, aucun oracle.
--   2. EXECUTE retiré à `anon` et PUBLIC. `authenticated` garde son GRANT
--      explicite (20260611180000) : les écrans du gestionnaire l'appellent
--      sous son rôle.
--
-- Appelants (grep 2026-10-29) : les routes `api/v1/gestionnaire/evenements`,
-- `api/v1/gestionnaire/evenements/[id]` et `api/v1/gestionnaire/collectes`,
-- toutes réservées au rôle `gestionnaire_lieux` ; la PR #672 n'appelle la
-- fonction que pour ce rôle. Aucun écran Admin ni aucune route service_role.
--
-- SÉCURITÉ (CLAUDE.md §12-2bis) : migration qui FERME un accès, aucun droit
-- ouvert ni élargi. `CREATE OR REPLACE` conserve propriétaire et privilèges ;
-- SECURITY DEFINER et search_path sont recopiés à l'identique (le
-- remplacement réécrit `proconfig`). Corps identique à 20261025100000, seule
-- la garde de périmètre change. Non destructive : aucun objet créé, supprimé
-- ni renommé, signature inchangée.
-- Preuve : supabase/tests/dechets_labo_reserve_gestionnaire.test.sql.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.f_dechets_labo_estimes(p_evenement_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS
$$
  -- NULL (et non 0) quand le pax de l'événement vaut 0, quand le traiteur
  -- opérationnel n'a pas de coefficient pour l'année de l'événement − 1, quand
  -- l'appelant n'est ni staff ni gestionnaire de lieux, ou quand l'événement
  -- est hors du périmètre du gestionnaire.
  SELECT e.pax * c.coefficient_kg_couvert
  FROM plateforme.evenements e
  JOIN plateforme.coefficients_perte_labo c
    ON c.organisation_id = e.traiteur_operationnel_organisation_id
   AND c.annee_reference = EXTRACT(YEAR FROM e.date_evenement)::integer - 1
  WHERE e.id = p_evenement_id
    AND e.pax > 0
    AND (
      plateforme.f_is_staff()
      OR (
        plateforme.f_app_role() = 'gestionnaire_lieux'
        AND (
          e.lieu_id IN (
            SELECT lieu_id FROM plateforme.organisations_lieux
            WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
          )
          OR e.organisation_id = (auth.jwt()->>'organisation_id')::uuid
        )
      )
    )
$$;

COMMENT ON FUNCTION plateforme.f_dechets_labo_estimes(uuid) IS
  'Estimation kg des déchets labo amont (§05 R_dechets_labo_estimes) = pax de '
  'l''événement × coefficient du traiteur opérationnel pour l''année de '
  'l''événement − 1. Réservée au gestionnaire de lieux (son périmètre) et au '
  'staff. NULL = pax 0, coefficient non communiqué pour cette année, autre rôle '
  'OU événement hors périmètre → UI affiche « — ». Coefficient = 0 reste 0 kg, '
  'distinct de NULL. Le coefficient brut n''est jamais exposé.';

REVOKE EXECUTE ON FUNCTION plateforme.f_dechets_labo_estimes(uuid)
  FROM anon, PUBLIC;

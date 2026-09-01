-- =============================================================================
-- count_collectes_par_org — compteur collectes ZD/AG par organisation (12 mois)
-- =============================================================================
-- Bug pré-existant (revue E2E /admin/clients) : la liste Clients Admin
-- (CDC §06.06 L555) affiche « nb collectes ZD (12 derniers mois) » et
-- « nb collectes AG (12 derniers mois) » par organisation, mais la RPC
-- `plateforme.count_collectes_par_org` appelée par
-- `packages/plateforme/src/app/api/v1/admin/organisations/route.ts` (≈ L57/L61)
-- n'existait dans AUCUNE migration ni en base → PGRST202 silencieux
-- (« Could not find the function ») → 0 partout (dev + prod). C'est l'un des
-- call-sites fantômes comptés dans la baseline `column-db` du gate-ratchet
-- (audit R0a) : cette migration + l'ajout dans `database.types.ts` le résorbent.
--
-- Définition (CDC §06.06 « Revenus par organisation », lignes 90-92) :
--   Nb collectes <type> = COUNT des collectes de `type`,
--   `date_collecte >= depuis`, rattachées via `evenement` à
--   `evenement.organisation_id = <org>`.
-- Statut : exclut 'brouillon' et 'annulee' — même sémantique que la vue
--   `plateforme.v_kpi_admin` (dashboard §11), pour que le compte affiché sur la
--   liste Clients coïncide avec le dashboard (pas de définition divergente).
--
-- Contrat consommé par route.ts :
--   .rpc('count_collectes_par_org', { type_collecte: 'zd'|'ag', depuis: 'YYYY-MM-DD' })
--   → renvoie [{ organisation_id, nb }]. Les orgs sans collecte sur la fenêtre
--     ne sont pas retournées (GROUP BY sur l'ensemble filtré) : la route mappe
--     l'absence à 0 (`statsZd[o.id] ?? 0`).
--
-- SECURITY DEFINER : la fonction agrège TOUTES les organisations (aucun scope
--   RLS possible). Réservée au `service_role` (route back-office admin, gardée
--   en amont par requireStaff). REVOKE PUBLIC/anon/authenticated pour empêcher
--   qu'un JWT client puisse lister les volumes de collectes de tout le parc.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.count_collectes_par_org(
  type_collecte text,
  depuis        date
)
RETURNS TABLE (organisation_id uuid, nb bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = plateforme, pg_temp
AS $$
  SELECT
    e.organisation_id,
    COUNT(c.id) AS nb
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  WHERE c.date_collecte >= depuis
    AND c.statut NOT IN ('brouillon', 'annulee')
    AND c.type = CASE type_collecte
                   WHEN 'zd' THEN 'zero_dechet'::plateforme.collecte_type_enum
                   WHEN 'ag' THEN 'anti_gaspi'::plateforme.collecte_type_enum
                 END
  GROUP BY e.organisation_id;
$$;

COMMENT ON FUNCTION plateforme.count_collectes_par_org(text, date) IS
  'Liste Clients Admin (CDC §06.06 L555) : nb collectes ZD/AG (type_collecte '
  '= ''zd''|''ag'') sur 12 mois glissants (date_collecte >= depuis), par '
  'organisation (evenement.organisation_id), hors brouillon/annulee — aligné '
  'v_kpi_admin. service_role only (agrège tout le parc, hors RLS).';

-- Fonction transverse au parc (aucun cloisonnement org) : réservée au rôle
-- serveur de confiance. PostgREST accorde EXECUTE à PUBLIC par défaut → REVOKE
-- explicite pour anon/authenticated, sinon fuite inter-org depuis un JWT client.
REVOKE EXECUTE ON FUNCTION plateforme.count_collectes_par_org(text, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION plateforme.count_collectes_par_org(text, date) FROM anon;
REVOKE EXECUTE ON FUNCTION plateforme.count_collectes_par_org(text, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION plateforme.count_collectes_par_org(text, date) TO service_role;

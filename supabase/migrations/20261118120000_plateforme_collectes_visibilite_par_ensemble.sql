-- Lecture des collectes et de leurs flux : le contrôle d'accès est calculé une
-- fois par requête, et non plus une fois par ligne (test de charge du
-- 2026-11-18).
--
-- Constat mesuré sur savr-dev le 2026-11-18 : `col_select` et `cf_select`
-- appelaient `plateforme.f_collecte_visible(id)` pour CHAQUE ligne candidate.
-- Fonction SECURITY DEFINER, donc jamais dépliée par le planificateur, et
-- évaluée avant le filtre d'organisation de la requête : pour le tableau de
-- bord d'un traiteur, 459 collectes de toutes les organisations et 765 flux
-- vérifiés un par un pour en garder 153. 79 ms contre 2 ms sans le contrôle,
-- et, sous 50 utilisateurs, 0,65 à 1 s par lecture du tableau de bord.
--
-- Même règle, écrite par ensembles : trois fonctions rendent, une fois par
-- requête, les identifiants d'événements (ou de collectes) que le jeton voit ;
-- la policy teste l'appartenance à cet ensemble (sous-plan haché). La règle de
-- `f_collecte_visible` est reprise telle quelle, branche par branche :
--   - équipe Savr (admin_savr, ops_savr) : tout (evenement_id est NOT NULL et
--     référence un événement, la jointure de l'ancienne fonction est donc
--     toujours vraie) ;
--   - événement programmé par l'organisation du jeton, dont elle est le traiteur
--     opérationnel, ou le client organisateur ;
--   - événement daté sur un lieu de l'organisation du jeton, collecte hors
--     brouillon (garde anti-fuite des brouillons tiers B-2 et 2026-10-24).
-- Le test `SECU__collectes_visibilite_par_ensemble.test.sql` compare, rôle par
-- rôle, ce que voit chaque jeton à ce que rend `f_collecte_visible`, gardée
-- telle quelle (bordereaux, tournées, fichiers, registre l'utilisent encore).
--
-- Récursion de policies : une sous-requête dans une policy de `collectes` fait
-- lever « infinite recursion detected in policy » dès qu'une policy d'une table
-- qu'elle atteint relit `collectes` dans une sous-requête (chemin UPDATE
-- collectes → evenements → collectes, cf. docs/claude/code-verification.md).
-- Le seul maillon de retour était `evt_gestionnaire_select` (EXISTS sur
-- `collectes`) : il passe par la fonction `f_evenements_visibles_lieux`, qui lit
-- `collectes` hors RLS. Équivalent : pour un événement daté sur un lieu de
-- l'organisation, une collecte hors brouillon est visible du gestionnaire par la
-- branche « lieu » de `f_collecte_visible` ; la RLS ne retirait donc rien de
-- plus que la règle du code de vérification, que la fonction applique aussi.
--
-- Accès : aucun élargi. Les trois fonctions sont SECURITY DEFINER et ouvertes à
-- `authenticated` parce que les policies les appellent sous le rôle de
-- l'appelant (famille (a) de l'allowlist de securite_rpc_definer_exposees).
-- Appelées directement (PostgREST /rpc), elles ne rendent que des identifiants
-- que le jeton lit déjà : un événement rendu porte au moins une collecte que
-- le jeton voit (revue sécurité du 2026-11-18 : sans l'EXISTS de
-- `f_evenements_visibles_organisation`, un événement SANS collecte qui cite
-- l'organisation dans une colonne que la policy de son rôle ne lit pas, par
-- exemple client organisateur d'un jeton traiteur, sortait par l'appel direct).
-- Elles appellent `f_code_verification_ok()` (cliquet SECU__code_verification_base,
-- assertion 14) et sont fermées à PUBLIC et anon. ⚠ Ouverture de fonctions à
-- `authenticated` : migration prod soumise à Val (CLAUDE.md §12, 2bis).

BEGIN;

-- Événements dont l'organisation du jeton est le programmateur, le traiteur
-- opérationnel ou le client organisateur, et qui portent au moins une collecte
-- (sans elle, l'appel direct rendrait des événements que le jeton ne lit pas ;
-- les policies n'en perdent rien : une collecte témoigne de son événement).
CREATE OR REPLACE FUNCTION plateforme.f_evenements_visibles_organisation()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'plateforme', 'pg_catalog'
ROWS 200
AS $function$
  SELECT e.id
  FROM plateforme.evenements e
  WHERE plateforme.f_code_verification_ok()
    AND (   e.organisation_id                       = (auth.jwt()->>'organisation_id')::uuid
         OR e.traiteur_operationnel_organisation_id = (auth.jwt()->>'organisation_id')::uuid
         OR e.client_organisateur_organisation_id   = (auth.jwt()->>'organisation_id')::uuid)
    AND EXISTS (SELECT 1 FROM plateforme.collectes c WHERE c.evenement_id = e.id)
$function$;

-- Événements datés sur un lieu de l'organisation du jeton, qui portent au moins
-- une collecte hors brouillon.
CREATE OR REPLACE FUNCTION plateforme.f_evenements_visibles_lieux()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'plateforme', 'pg_catalog'
ROWS 200
AS $function$
  SELECT e.id
  FROM plateforme.evenements e
  WHERE plateforme.f_code_verification_ok()
    AND e.date_evenement IS NOT NULL
    AND e.lieu_id IN (
      SELECT ol.lieu_id
      FROM plateforme.organisations_lieux ol
      WHERE ol.organisation_id = (auth.jwt()->>'organisation_id')::uuid
    )
    AND EXISTS (
      SELECT 1
      FROM plateforme.collectes c
      WHERE c.evenement_id = e.id
        AND c.statut <> 'brouillon'
    )
$function$;

-- Collectes visibles d'un jeton client (hors équipe Savr), pour les flux.
CREATE OR REPLACE FUNCTION plateforme.f_collectes_visibles_client()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'plateforme', 'pg_catalog'
ROWS 500
AS $function$
  SELECT c.id
  FROM plateforme.collectes c
  WHERE plateforme.f_code_verification_ok()
    AND (   c.evenement_id IN (SELECT plateforme.f_evenements_visibles_organisation())
         OR (    c.statut <> 'brouillon'
             AND c.evenement_id IN (SELECT plateforme.f_evenements_visibles_lieux())))
$function$;

REVOKE ALL ON FUNCTION plateforme.f_evenements_visibles_organisation() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION plateforme.f_evenements_visibles_lieux() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION plateforme.f_collectes_visibles_client() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION plateforme.f_evenements_visibles_organisation() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION plateforme.f_evenements_visibles_lieux() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION plateforme.f_collectes_visibles_client() TO authenticated, service_role;

ALTER POLICY col_select ON plateforme.collectes
  USING (
    plateforme.f_code_verification_ok()
    AND (   plateforme.f_app_role() IN ('admin_savr', 'ops_savr')
         OR evenement_id IN (SELECT plateforme.f_evenements_visibles_organisation())
         OR (    statut <> 'brouillon'
             AND evenement_id IN (SELECT plateforme.f_evenements_visibles_lieux())))
  );

ALTER POLICY cf_select ON plateforme.collecte_flux
  USING (
    plateforme.f_code_verification_ok()
    AND (   plateforme.f_app_role() IN ('admin_savr', 'ops_savr')
         OR collecte_id IN (SELECT plateforme.f_collectes_visibles_client()))
  );

-- Seul changement : l'EXISTS sur `collectes` passe par la fonction (voir
-- l'en-tête). Le filtre du lieu reste lu sous la RLS de l'appelant, comme avant.
ALTER POLICY evt_gestionnaire_select ON plateforme.evenements
  USING (
    plateforme.f_app_role() = 'gestionnaire_lieux'
    AND (   organisation_id = (auth.jwt()->>'organisation_id')::uuid
         OR (    date_evenement IS NOT NULL
             AND lieu_id IN (
               SELECT organisations_lieux.lieu_id
               FROM plateforme.organisations_lieux
               WHERE organisations_lieux.organisation_id = (auth.jwt()->>'organisation_id')::uuid
             )
             AND id IN (SELECT plateforme.f_evenements_visibles_lieux())))
  );

COMMIT;
